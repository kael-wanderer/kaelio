use base64::{Engine as _, engine::general_purpose};
use git2::{Cred, CredentialType, Repository, Signature, StatusOptions};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

static INITIAL_FILE: Mutex<Option<String>> = Mutex::new(None);
static FILE_WATCHERS: Mutex<Option<HashMap<String, RecommendedWatcher>>> = Mutex::new(None);
static FOLDER_WATCHERS: Mutex<Option<HashMap<String, RecommendedWatcher>>> = Mutex::new(None);

#[cfg(unix)]
fn raise_file_descriptor_limit() {
    unsafe {
        let mut limit = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        if libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) != 0 {
            return;
        }
        // Keep the soft limit finite and below Darwin's OPEN_MAX. macOS
        // `posix_spawn` can fail with EBADF when stdio is redirected and
        // RLIMIT_NOFILE is infinity or extremely high, even when fd 0/1/2 are
        // valid. 10_240 is still ample for Kaelio and avoids the spawn bug.
        const SAFE_NOFILE: libc::rlim_t = 10_240;
        let target = if limit.rlim_max == libc::RLIM_INFINITY {
            SAFE_NOFILE
        } else {
            limit.rlim_max.min(SAFE_NOFILE)
        };
        if target != limit.rlim_cur {
            let new_limit = libc::rlimit {
                rlim_cur: target,
                rlim_max: limit.rlim_max,
            };
            let _ = libc::setrlimit(libc::RLIMIT_NOFILE, &new_limit);
        }
    }
}

#[cfg(not(unix))]
fn raise_file_descriptor_limit() {}

/// Apps launched from Finder/LaunchServices can start with stdin/stdout/stderr
/// (fds 0/1/2) closed. Later file opens then take those low fd numbers, and when
/// we spawn a child process (pandoc, typst) the stdio redirection collides
/// and `posix_spawn` fails with "Bad file descriptor (os error 9)". Guarantee
/// 0/1/2 are valid by pointing any closed ones at /dev/null before anything else.
#[cfg(unix)]
fn ensure_std_fds() {
    unsafe {
        for fd in 0..3 {
            if libc::fcntl(fd, libc::F_GETFD) != -1 {
                continue;
            }
            let devnull = libc::open(c"/dev/null".as_ptr(), libc::O_RDWR);
            if devnull < 0 {
                break;
            }
            if devnull != fd {
                libc::dup2(devnull, fd);
                libc::close(devnull);
            }
        }
    }
}

#[cfg(not(unix))]
fn ensure_std_fds() {}

/// When launched from a dev shell, the app can inherit thousands of open file
/// descriptors (e.g. another project's node_modules held by a running dev
/// server). That bloated descriptor table later breaks child-process spawning
/// (pandoc/typst) with "Bad file descriptor (os error 9)" or, under a finite
/// limit, "too many open files (os error 24)". Close every inherited descriptor
/// above stderr at startup, before Tauri opens anything of its own. Reading
/// /dev/fd touches only descriptors that are actually open.
#[cfg(all(unix, not(test)))]
fn close_inherited_fds() {
    let open_fds: Vec<i32> = match std::fs::read_dir("/dev/fd") {
        Ok(rd) => rd
            .flatten()
            .filter_map(|e| e.file_name().to_str().and_then(|s| s.parse::<i32>().ok()))
            .collect(),
        Err(_) => return,
    };
    for fd in open_fds {
        if fd <= 2 {
            continue;
        }
        // Only close inherited regular files and directories (the node_modules
        // junk). Leave pipes/sockets/kqueues/char devices alone — the runtime or
        // Tauri may legitimately rely on them.
        unsafe {
            let mut st: libc::stat = std::mem::zeroed();
            if libc::fstat(fd, &mut st) == 0 {
                let kind = st.st_mode & libc::S_IFMT;
                if kind == libc::S_IFREG || kind == libc::S_IFDIR {
                    libc::close(fd);
                }
            }
        }
    }
}

#[cfg(not(all(unix, not(test))))]
fn close_inherited_fds() {}

/// Rust may use macOS `posix_spawn` for simple `Command`s. Finder-launched apps
/// can still hit EBADF inside that fast path even after fd 0/1/2 and RLIMIT are
/// sane. A no-op `pre_exec` forces the older fork/exec path for fragile external
/// tools such as pandoc and typst.
#[cfg(unix)]
fn force_fork_exec(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    unsafe {
        command.pre_exec(|| Ok(()));
    }
}

#[cfg(not(unix))]
fn force_fork_exec(_command: &mut Command) {}

/// Reports whether fds 0/1/2 are open — appended to spawn errors so we can tell
/// a closed-fd failure apart from other posix_spawn errors.
#[cfg(unix)]
fn fd_diagnostic() -> String {
    let mut parts = Vec::new();
    unsafe {
        for fd in 0..3 {
            let ok = libc::fcntl(fd, libc::F_GETFD) != -1;
            parts.push(format!("fd{}={}", fd, if ok { "ok" } else { "CLOSED" }));
        }
    }
    parts.join(" ")
}

#[cfg(not(unix))]
fn fd_diagnostic() -> String {
    String::new()
}

#[cfg(unix)]
fn nofile_diagnostic() -> String {
    unsafe {
        let mut limit = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        if libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) == 0 {
            format!(
                "nofile_cur={} nofile_max={}",
                limit.rlim_cur, limit.rlim_max
            )
        } else {
            "nofile=unknown".to_string()
        }
    }
}

#[cfg(not(unix))]
fn nofile_diagnostic() -> String {
    String::new()
}

fn spawn_diagnostic() -> String {
    let parts = [fd_diagnostic(), nofile_diagnostic()];
    parts
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// A per-export scratch directory. Unique per call so two windows exporting at
/// the same time cannot overwrite or delete each other's files.
fn unique_export_dir(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("{}_{}_{}", prefix, std::process::id(), nanos))
}

/// Returns ~/.kaelio, migrating from the legacy ~/.mx folder on first access.
fn kaelio_home() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|e| e.to_string())?;
    let new_dir = PathBuf::from(&home).join(".kaelio");
    let old_dir = PathBuf::from(&home).join(".mx");
    if !new_dir.exists() && old_dir.exists() {
        let _ = fs::rename(&old_dir, &new_dir);
    }
    fs::create_dir_all(&new_dir).map_err(|e| e.to_string())?;
    Ok(new_dir)
}

#[derive(Serialize, Deserialize)]
struct FileInfo {
    path: String,
    content: String,
    size: u64,
    modified_ms: u64,
}

#[derive(Serialize, Deserialize)]
struct FileMetadata {
    path: String,
    size: u64,
    modified_ms: u64,
}

#[derive(Serialize, Deserialize)]
struct BinaryFileInfo {
    path: String,
    data_base64: String,
    mime_type: String,
    size: u64,
    modified_ms: u64,
}

#[derive(Serialize, Deserialize)]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    extension: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct DeleteResult {
    destination: String,
    used_system_trash: bool,
}

fn next_natural_chunk(s: &str, start: usize) -> Option<(&str, usize, bool)> {
    if start >= s.len() {
        return None;
    }
    let mut end = start;
    let first = s[start..].chars().next()?;
    let is_digit = first.is_ascii_digit();
    while end < s.len() {
        let c = s[end..].chars().next()?;
        if c.is_ascii_digit() != is_digit {
            break;
        }
        end += c.len_utf8();
    }
    Some((&s[start..end], end, is_digit))
}

fn compare_number_chunks(a: &str, b: &str) -> Ordering {
    let a_trimmed = a.trim_start_matches('0');
    let b_trimmed = b.trim_start_matches('0');
    let a_normalized = if a_trimmed.is_empty() { "0" } else { a_trimmed };
    let b_normalized = if b_trimmed.is_empty() { "0" } else { b_trimmed };

    a_normalized
        .len()
        .cmp(&b_normalized.len())
        .then_with(|| a_normalized.cmp(b_normalized))
        .then_with(|| a.len().cmp(&b.len()))
}

fn natural_name_cmp(a: &str, b: &str) -> Ordering {
    let mut a_pos = 0;
    let mut b_pos = 0;

    loop {
        match (next_natural_chunk(a, a_pos), next_natural_chunk(b, b_pos)) {
            (Some((a_chunk, next_a, true)), Some((b_chunk, next_b, true))) => {
                let cmp = compare_number_chunks(a_chunk, b_chunk);
                if cmp != Ordering::Equal {
                    return cmp;
                }
                a_pos = next_a;
                b_pos = next_b;
            }
            (Some((a_chunk, next_a, _)), Some((b_chunk, next_b, _))) => {
                let cmp = a_chunk.to_lowercase().cmp(&b_chunk.to_lowercase());
                if cmp != Ordering::Equal {
                    return cmp;
                }
                a_pos = next_a;
                b_pos = next_b;
            }
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
        }
    }
}

#[derive(Serialize, Deserialize)]
struct WordCount {
    chars: usize,
    words: usize,
    lines: usize,
}

#[derive(Serialize, Deserialize)]
struct GitFileStatus {
    path: String,
    status: String,
}

#[derive(Serialize, Deserialize)]
struct GitRepoInfo {
    is_repo: bool,
    branch: String,
    remote_url: Option<String>,
    ahead: usize,
    behind: usize,
}

#[derive(Serialize, Deserialize)]
struct GitLogEntry {
    id: String,
    message: String,
    author: String,
    timestamp: i64,
}

#[derive(Serialize, Deserialize)]
struct GitDiffResult {
    old_content: String,
    new_content: String,
    patch: String,
}

#[derive(Serialize, Deserialize)]
struct GitSyncResult {
    committed: bool,
    pushed: bool,
    pulled: bool,
    message: String,
    conflicts: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct GitConflictInfo {
    path: String,
    local_content: String,
    remote_content: String,
    base_content: String,
}

#[tauri::command]
fn read_file(path: String) -> Result<FileInfo, String> {
    let p = PathBuf::from(&path);
    let content = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let metadata = fs::metadata(&p).map_err(|e| e.to_string())?;
    Ok(FileInfo {
        path,
        content,
        size: metadata.len(),
        modified_ms: metadata_modified_ms(&metadata),
    })
}

fn image_mime_type(path: &Path) -> String {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
    .to_string()
}

#[tauri::command]
fn read_binary_file(path: String) -> Result<BinaryFileInfo, String> {
    let p = PathBuf::from(&path);
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    let metadata = fs::metadata(&p).map_err(|e| e.to_string())?;
    Ok(BinaryFileInfo {
        path,
        data_base64: general_purpose::STANDARD.encode(bytes),
        mime_type: image_mime_type(&p),
        size: metadata.len(),
        modified_ms: metadata_modified_ms(&metadata),
    })
}

/// File types Kaelio no longer shows itself; they go to the system default app.
/// Mirrors EXTERNAL in src/lib/file-kind.ts.
const DEFAULT_APP_EXTENSIONS: &[&str] = &[
    "pdf", "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "svg",
];

/// Returns the canonical path when `path` is an existing regular file with an
/// allow-listed extension. Anything else (scripts, app bundles, folders) is refused,
/// so the frontend cannot use this to launch arbitrary programs.
fn default_app_target(path: &Path) -> Result<PathBuf, String> {
    let refused = || "Cannot open this file".to_string();
    let canonical = fs::canonicalize(path).map_err(|_| refused())?;
    let metadata = fs::metadata(&canonical).map_err(|_| refused())?;
    if !metadata.is_file() {
        return Err(refused());
    }
    let ext = canonical
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .ok_or_else(refused)?;
    if !DEFAULT_APP_EXTENSIONS.contains(&ext.as_str()) {
        return Err(refused());
    }
    Ok(canonical)
}

#[tauri::command]
fn open_in_default_app(path: String) -> Result<(), String> {
    let target = default_app_target(Path::new(&path))?;
    tauri_plugin_opener::open_path(&target, None::<&str>)
        .map_err(|_| "Cannot open this file".to_string())
}

fn metadata_modified_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

#[tauri::command]
fn file_metadata(path: String) -> Result<FileMetadata, String> {
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    Ok(FileMetadata {
        path,
        size: metadata.len(),
        modified_ms: metadata_modified_ms(&metadata),
    })
}

#[tauri::command]
fn save_binary_base64(path: String, data_base64: String) -> Result<(), String> {
    let bytes = general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|e| e.to_string())?;
    fs::write(path, bytes).map_err(|e| e.to_string())
}

/// Native menu items whose accelerator follows the user's shortcut bindings.
const BINDABLE_MENU_ITEMS: &[&str] = &[
    "file.new",
    "file.open",
    "file.new-window",
    "file.save",
    "file.close-tab",
    "edit.copy-formatted",
    "view.explorer",
    "view.preview",
    "view.reading",
    "view.zoom-in",
    "view.zoom-out",
    "view.zoom-reset",
    "search.command-palette",
    "search.file-search",
    "search.content-search",
    "help.shortcuts",
];

fn validate_menu_accelerator(id: &str, accel: Option<&str>) -> Result<(), String> {
    if !BINDABLE_MENU_ITEMS.contains(&id) {
        return Err("Unknown menu item".to_string());
    }
    if let Some(a) = accel {
        let ok = !a.is_empty()
            && a.len() <= 40
            && a.chars().all(|c| c.is_ascii_alphanumeric() || "+-=/[];',.`\\".contains(c));
        if !ok {
            return Err("Invalid accelerator".to_string());
        }
    }
    Ok(())
}

fn find_menu_item<R: tauri::Runtime>(
    items: Vec<tauri::menu::MenuItemKind<R>>,
    id: &str,
) -> Option<MenuItem<R>> {
    for item in items {
        match item {
            tauri::menu::MenuItemKind::MenuItem(mi) if mi.id().as_ref() == id => return Some(mi),
            tauri::menu::MenuItemKind::Submenu(sub) => {
                if let Some(found) = sub.items().ok().and_then(|it| find_menu_item(it, id)) {
                    return Some(found);
                }
            }
            _ => {}
        }
    }
    None
}

/// Keeps native menu accelerators in line with the effective shortcut bindings
/// (custom bindings win; a key unbound in Kaelio is cleared from the menu too).
#[tauri::command]
fn set_menu_accelerators(
    app: tauri::AppHandle,
    accels: HashMap<String, Option<String>>,
) -> Result<(), String> {
    let Some(menu) = app.menu() else { return Ok(()) };
    let items = menu.items().map_err(|_| "Menu unavailable".to_string())?;
    for (id, accel) in &accels {
        validate_menu_accelerator(id, accel.as_deref())?;
        if let Some(mi) = find_menu_item(items.clone(), id) {
            mi.set_accelerator(accel.as_deref())
                .map_err(|_| "Invalid accelerator".to_string())?;
        }
    }
    Ok(())
}

const MAX_PASTED_IMAGE_BYTES: usize = 20 * 1024 * 1024;

/// Maps an allowed clipboard image MIME type to its file extension, but only
/// when the bytes really start with that format's signature.
fn pasted_image_extension(bytes: &[u8], mime: &str) -> Result<&'static str, String> {
    let (ext, ok) = match mime {
        "image/png" => ("png", bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47])),
        "image/jpeg" => ("jpg", bytes.starts_with(&[0xFF, 0xD8, 0xFF])),
        "image/gif" => ("gif", bytes.starts_with(b"GIF8")),
        "image/webp" => (
            "webp",
            bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        ),
        _ => return Err("Unsupported image type".to_string()),
    };
    if ok {
        Ok(ext)
    } else {
        Err("Invalid image data".to_string())
    }
}

/// `YYYYMMDD-HHMMSS`: exactly 8 digits, a dash, 6 digits.
fn is_valid_paste_stamp(stamp: &str) -> bool {
    let b = stamp.as_bytes();
    b.len() == 15
        && b[8] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 8 || c.is_ascii_digit())
}

/// Saves a pasted image to `<note folder>/assets/pasted-<stamp>.<ext>` (with a
/// `-2`, `-3`… suffix on collision) and returns the path relative to the note's
/// folder with `/` separators. Never overwrites an existing file.
fn save_pasted_image_impl(
    note_path: &Path,
    bytes: &[u8],
    mime: &str,
    stamp: &str,
) -> Result<String, String> {
    let ext = pasted_image_extension(bytes, mime)?;
    if bytes.len() > MAX_PASTED_IMAGE_BYTES {
        return Err("Image too large".to_string());
    }
    if !is_valid_paste_stamp(stamp) {
        return Err("Invalid image data".to_string());
    }
    let is_file = fs::metadata(note_path).map(|m| m.is_file()).unwrap_or(false);
    let folder = match note_path.parent() {
        Some(p) if is_file => p,
        _ => return Err("Save the note first".to_string()),
    };
    let assets = folder.join("assets");
    fs::create_dir_all(&assets).map_err(|_| "Could not create assets folder".to_string())?;

    for n in 1..=1000u32 {
        let name = if n == 1 {
            format!("pasted-{}.{}", stamp, ext)
        } else {
            format!("pasted-{}-{}.{}", stamp, n, ext)
        };
        let target = assets.join(&name);
        match fs::OpenOptions::new().write(true).create_new(true).open(&target) {
            Ok(mut file) => {
                use std::io::Write;
                if file.write_all(bytes).and_then(|_| file.sync_all()).is_err() {
                    drop(file);
                    let _ = fs::remove_file(&target);
                    return Err("Could not save image".to_string());
                }
                return Ok(format!("assets/{}", name));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("Could not save image".to_string()),
        }
    }
    Err("Could not save image".to_string())
}

#[tauri::command]
fn save_pasted_image(
    note_path: String,
    data_base64: String,
    mime: String,
    stamp: String,
) -> Result<String, String> {
    // Reject before decoding: base64 of 20 MB is at most ~26.7 MB of text.
    if data_base64.len() > (MAX_PASTED_IMAGE_BYTES / 3 + 1) * 4 {
        return Err("Image too large".to_string());
    }
    let bytes = general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|_| "Invalid image data".to_string())?;
    save_pasted_image_impl(Path::new(&note_path), &bytes, &mime, &stamp)
}

/// Writes `bytes` to `path` without ever leaving a truncated file behind: the
/// data goes to a temporary file in the same directory, is flushed to disk, and
/// is then renamed over the target. A symlink is followed so the link survives.
/// If the directory does not allow creating the temporary file, falls back to
/// a direct write (the previous behaviour).
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let target = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let (Some(dir), Some(name)) = (target.parent(), target.file_name()) else {
        return Err("Invalid file path".to_string());
    };
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let tmp = dir.join(format!(
        ".{}.kaelio-tmp-{}-{}",
        name.to_string_lossy(),
        std::process::id(),
        nanos
    ));
    let mut file = match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
    {
        Ok(f) => f,
        Err(_) => return fs::write(&target, bytes).map_err(|e| e.to_string()),
    };
    let result = (|| -> std::io::Result<()> {
        file.write_all(bytes)?;
        file.sync_all()?;
        if let Ok(meta) = fs::metadata(&target) {
            let _ = fs::set_permissions(&tmp, meta.permissions());
        }
        fs::rename(&tmp, &target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(|e| e.to_string())
}

#[tauri::command]
fn save_file(path: String, content: String) -> Result<(), String> {
    write_atomic(Path::new(&path), content.as_bytes())
}

#[tauri::command]
fn word_count(text: String) -> WordCount {
    WordCount {
        chars: text.chars().count(),
        words: text.split_whitespace().count(),
        lines: text.lines().count(),
    }
}

#[tauri::command]
fn list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    let p = PathBuf::from(&path);
    let entries = fs::read_dir(&p).map_err(|e| e.to_string())?;
    let mut result: Vec<DirEntry> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            let is_dir = metadata.is_dir();
            let extension = if is_dir {
                None
            } else {
                entry
                    .path()
                    .extension()
                    .map(|e| e.to_string_lossy().to_string())
            };
            Some(DirEntry {
                name,
                path: entry.path().to_string_lossy().to_string(),
                is_dir,
                extension,
            })
        })
        .collect();
    result.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| natural_name_cmp(&a.name, &b.name))
    });
    Ok(result)
}

#[tauri::command]
fn get_home_dir() -> Result<String, String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_initial_file() -> Option<String> {
    INITIAL_FILE.lock().unwrap().take()
}

#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    // create_new fails if the path exists, with no gap between check and create.
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
    {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            Err("File already exists".to_string())
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.exists() {
        return Err("Directory already exists".to_string());
    }
    fs::create_dir(&p).map_err(|e| e.to_string())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("create '{}': {}", dst.display(), e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("read '{}': {}", src.display(), e))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let metadata = entry
            .metadata()
            .map_err(|e| format!("metadata '{}': {}", src_path.display(), e))?;
        if metadata.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| {
                format!(
                    "copy '{}' to '{}': {}",
                    src_path.display(),
                    dst_path.display(),
                    e
                )
            })?;
        }
    }
    Ok(())
}

fn unique_copy_path(dest_dir: &Path, source: &Path) -> Result<PathBuf, String> {
    let stem = source
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| {
            source
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "copy".to_string())
        });
    let ext = source
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();

    let original = source.file_name().ok_or("Source path has no file name")?;
    let mut dest = dest_dir.join(original);
    if !dest.exists() {
        return Ok(dest);
    }

    dest = dest_dir.join(format!("{}-copy{}", stem, ext));
    let mut counter = 2u32;
    while dest.exists() {
        dest = dest_dir.join(format!("{}-copy-{}{}", stem, counter, ext));
        counter += 1;
    }
    Ok(dest)
}

#[tauri::command]
fn copy_into_folder(source: String, dest_dir: String) -> Result<String, String> {
    let src = PathBuf::from(&source);
    if !src.exists() {
        return Err(format!("Source path does not exist: {}", src.display()));
    }

    let dest_dir = PathBuf::from(&dest_dir);
    if !dest_dir.exists() || !dest_dir.is_dir() {
        return Err(format!(
            "Destination is not a folder: {}",
            dest_dir.display()
        ));
    }

    let src_canon = fs::canonicalize(&src).map_err(|e| format!("canonicalize source: {}", e))?;
    let dest_dir_canon =
        fs::canonicalize(&dest_dir).map_err(|e| format!("canonicalize destination: {}", e))?;
    if src_canon.is_dir() && dest_dir_canon.starts_with(&src_canon) {
        return Err("Cannot copy a folder into itself or one of its subfolders".to_string());
    }

    let dest = unique_copy_path(&dest_dir, &src)?;
    if src.is_dir() {
        copy_dir_recursive(&src, &dest)?;
    } else {
        fs::copy(&src, &dest)
            .map_err(|e| format!("copy '{}' to '{}': {}", src.display(), dest.display(), e))?;
    }

    Ok(dest.to_string_lossy().to_string())
}

fn unique_kaelio_trash_path(path: &Path) -> Result<PathBuf, String> {
    let trash_dir = kaelio_home()?.join("trash");
    fs::create_dir_all(&trash_dir).map_err(|e| e.to_string())?;

    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("deleted");

    for suffix in 0..1000 {
        let candidate_name = if suffix == 0 {
            format!("{}-{}", timestamp_ms, file_name)
        } else {
            format!("{}-{}-{}", timestamp_ms, suffix, file_name)
        };
        let candidate = trash_dir.join(candidate_name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Could not create a unique Kaelio trash path".to_string())
}

fn move_to_kaelio_trash(path: &Path) -> Result<DeleteResult, String> {
    let destination = unique_kaelio_trash_path(path)?;
    match fs::rename(path, &destination) {
        Ok(()) => Ok(DeleteResult {
            destination: destination.to_string_lossy().to_string(),
            used_system_trash: false,
        }),
        Err(rename_err) => {
            let fallback = (|| -> Result<DeleteResult, String> {
                let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
                if metadata.is_dir() {
                    copy_dir_recursive(path, &destination)?;
                    fs::remove_dir_all(path)
                        .map_err(|e| format!("remove original directory after copy: {}", e))?;
                } else {
                    fs::copy(path, &destination).map_err(|e| {
                        format!(
                            "copy '{}' to '{}': {}",
                            path.display(),
                            destination.display(),
                            e
                        )
                    })?;
                    fs::remove_file(path)
                        .map_err(|e| format!("remove original file after copy: {}", e))?;
                }
                Ok(DeleteResult {
                    destination: destination.to_string_lossy().to_string(),
                    used_system_trash: false,
                })
            })();
            fallback.map_err(|e| format!("rename failed: {}; {}", rename_err, e))
        }
    }
}

#[tauri::command]
fn delete_entry(path: String) -> Result<DeleteResult, String> {
    let original_path = PathBuf::from(&path);
    let delete_path = fs::canonicalize(&original_path).unwrap_or(original_path);
    if !delete_path.exists() {
        return Err(format!("'{}' does not exist", delete_path.display()));
    }

    match trash::delete(&delete_path) {
        Ok(()) => Ok(DeleteResult {
            destination: "System Trash".to_string(),
            used_system_trash: true,
        }),
        Err(native_err) => move_to_kaelio_trash(&delete_path).map_err(|fallback_err| {
            format!(
                "Could not move '{}' to system Trash ({}) or Kaelio trash ({}).",
                delete_path.display(),
                native_err,
                fallback_err
            )
        }),
    }
}

#[tauri::command]
fn rename_entry(old_path: String, new_path: String) -> Result<(), String> {
    let np = PathBuf::from(&new_path);
    if np.exists() {
        return Err("Target already exists".to_string());
    }
    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_files_recursive(path: String, max_depth: u32) -> Result<Vec<String>, String> {
    let root = PathBuf::from(&path);
    let mut results = Vec::new();
    let ignore = ["node_modules", ".git", "target", ".DS_Store", "__pycache__"];
    fn walk(dir: &Path, depth: u32, max_depth: u32, results: &mut Vec<String>, ignore: &[&str]) {
        if depth > max_depth {
            return;
        }
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || ignore.contains(&name.as_str()) {
                continue;
            }
            let path = entry.path();
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    walk(&path, depth + 1, max_depth, results, ignore);
                } else {
                    results.push(path.to_string_lossy().to_string());
                }
            }
        }
    }
    walk(&root, 0, max_depth, &mut results, &ignore);
    results.sort();
    Ok(results)
}

#[derive(Serialize, Deserialize)]
struct SearchResult {
    result_type: String,
    file_path: String,
    line_number: usize,
    line_content: String,
    match_start: usize,
    match_end: usize,
}

#[tauri::command]
fn search_in_files(folder_path: String, query: String) -> Result<Vec<SearchResult>, String> {
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let root = PathBuf::from(&folder_path);
    let ignore = ["node_modules", ".git", "target", ".DS_Store", "__pycache__"];
    let extensions = ["md", "markdown", "txt"];
    let query_lower = query.to_lowercase();
    let max_results = 200usize;
    let max_file_size = 1_048_576u64;

    let mut all_files: Vec<PathBuf> = Vec::new();
    let mut content_files: Vec<PathBuf> = Vec::new();
    fn walk(
        dir: &Path,
        depth: u32,
        all_files: &mut Vec<PathBuf>,
        content_files: &mut Vec<PathBuf>,
        ignore: &[&str],
        extensions: &[&str],
        max_size: u64,
    ) {
        if depth > 5 {
            return;
        }
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || ignore.contains(&name.as_str()) {
                continue;
            }
            let path = entry.path();
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    walk(
                        &path,
                        depth + 1,
                        all_files,
                        content_files,
                        ignore,
                        extensions,
                        max_size,
                    );
                } else {
                    all_files.push(path.clone());
                    if meta.len() <= max_size {
                        if let Some(ext) = path.extension() {
                            if extensions.contains(&ext.to_string_lossy().as_ref()) {
                                content_files.push(path);
                            }
                        }
                    }
                }
            }
        }
    }
    walk(
        &root,
        0,
        &mut all_files,
        &mut content_files,
        &ignore,
        &extensions,
        max_file_size,
    );
    all_files.sort();
    content_files.sort();

    let mut results: Vec<SearchResult> = Vec::new();

    for file_path in &all_files {
        if results.len() >= max_results {
            break;
        }
        let file_name = match file_path.file_name().and_then(|name| name.to_str()) {
            Some(name) => name,
            None => continue,
        };
        let file_name_lower = file_name.to_lowercase();
        if let Some(byte_pos) = file_name_lower.find(&query_lower) {
            let char_start = file_name_lower[..byte_pos].chars().count();
            let char_end = char_start + query_lower.chars().count();
            results.push(SearchResult {
                result_type: "filename".to_string(),
                file_path: file_path.to_string_lossy().to_string(),
                line_number: 0,
                line_content: String::new(),
                match_start: char_start,
                match_end: char_end,
            });
        }
    }

    for file_path in content_files {
        if results.len() >= max_results {
            break;
        }
        let content = match fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let path_str = file_path.to_string_lossy().to_string();
        for (i, line) in content.lines().enumerate() {
            if results.len() >= max_results {
                break;
            }
            let line_lower = line.to_lowercase();
            if let Some(byte_pos) = line_lower.find(&query_lower) {
                // Convert byte offsets to char offsets for JavaScript compatibility
                let char_start = line_lower[..byte_pos].chars().count();
                let char_end = char_start + query_lower.chars().count();
                results.push(SearchResult {
                    result_type: "content".to_string(),
                    file_path: path_str.clone(),
                    line_number: i + 1,
                    line_content: line.to_string(),
                    match_start: char_start,
                    match_end: char_end,
                });
            }
        }
    }
    Ok(results)
}

#[derive(Serialize, Deserialize)]
struct RecoveryInfo {
    original_path: String,
    recovery_path: String,
    timestamp: u64,
}

fn get_recovery_dir() -> Result<PathBuf, String> {
    let dir = kaelio_home()?.join("recovery");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn path_to_recovery_name(path: &str) -> String {
    path.replace('/', "_").replace('\\', "_").replace(' ', "-")
}

#[tauri::command]
fn save_recovery(original_path: String, content: String) -> Result<(), String> {
    let dir = get_recovery_dir()?;
    let name = path_to_recovery_name(&original_path);
    let meta = format!("---mx-recovery---\n{}\n---\n", original_path);
    fs::write(dir.join(&name), format!("{}{}", meta, content)).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_recovery_files() -> Result<Vec<RecoveryInfo>, String> {
    let dir = get_recovery_dir()?;
    let mut results = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if let Ok(content) = fs::read_to_string(&path) {
            if let Some(rest) = content.strip_prefix("---mx-recovery---\n") {
                if let Some(idx) = rest.find("\n---\n") {
                    let original = rest[..idx].to_string();
                    let ts = entry
                        .metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    results.push(RecoveryInfo {
                        original_path: original,
                        recovery_path: path.to_string_lossy().to_string(),
                        timestamp: ts,
                    });
                }
            }
        }
    }
    Ok(results)
}

#[tauri::command]
fn read_recovery_content(recovery_path: String) -> Result<String, String> {
    let content = fs::read_to_string(&recovery_path).map_err(|e| e.to_string())?;
    if let Some(rest) = content.strip_prefix("---mx-recovery---\n") {
        if let Some(idx) = rest.find("\n---\n") {
            return Ok(rest[idx + 5..].to_string());
        }
    }
    Err("Invalid recovery file".to_string())
}

#[tauri::command]
fn delete_recovery(recovery_path: String) -> Result<(), String> {
    let _ = fs::remove_file(&recovery_path);
    Ok(())
}

/// A Mermaid diagram the frontend rendered to PNG for PDF/DOCX export.
#[derive(Deserialize)]
struct DiagramImage {
    name: String,
    data_base64: String,
}

const MAX_DIAGRAMS: usize = 200;
const MAX_DIAGRAM_BYTES: usize = 10 * 1024 * 1024;
const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

/// `kaelio-diagram-<16 lowercase hex>-<1..4 digits>.png`, nothing else (no separators, no other extension).
fn is_valid_diagram_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("kaelio-diagram-") else { return false };
    let Some(rest) = rest.strip_suffix(".png") else { return false };
    let Some((nonce, index)) = rest.split_once('-') else { return false };
    nonce.len() == 16
        && nonce.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && (1..=4).contains(&index.len())
        && index.bytes().all(|b| b.is_ascii_digit())
}

fn decode_diagram(diagram: &DiagramImage) -> Option<Vec<u8>> {
    if !is_valid_diagram_name(&diagram.name) {
        return None;
    }
    // Reject before decoding: base64 is 4 chars per 3 bytes.
    if diagram.data_base64.len() > MAX_DIAGRAM_BYTES / 3 * 4 + 8 {
        return None;
    }
    let bytes = general_purpose::STANDARD.decode(&diagram.data_base64).ok()?;
    if bytes.len() > MAX_DIAGRAM_BYTES || !bytes.starts_with(&PNG_SIGNATURE) {
        return None;
    }
    Some(bytes)
}

/// Writes validated diagram PNGs into `dir`. Any invalid entry fails the whole call and
/// removes the files this call already wrote.
fn write_diagrams(dir: &Path, diagrams: &[DiagramImage]) -> Result<Vec<(String, PathBuf)>, String> {
    use std::io::Write;
    let invalid = || "Invalid diagram data".to_string();
    if diagrams.len() > MAX_DIAGRAMS {
        return Err(invalid());
    }
    let mut written: Vec<(String, PathBuf)> = Vec::new();
    let result = (|| {
        for diagram in diagrams {
            let bytes = decode_diagram(diagram).ok_or_else(invalid)?;
            let path = dir.join(&diagram.name);
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|_| invalid())?;
            written.push((diagram.name.clone(), path));
            file.write_all(&bytes).map_err(|_| invalid())?;
        }
        Ok(())
    })();
    if let Err(e) = result {
        for (_, path) in &written {
            let _ = fs::remove_file(path);
        }
        return Err(e);
    }
    Ok(written)
}

/// Points each `](<name>)` image target at the absolute path of the written diagram.
fn link_diagrams(markdown: &str, written: &[(String, PathBuf)]) -> String {
    let mut out = markdown.to_string();
    for (name, path) in written {
        out = out.replace(&format!("]({name})"), &format!("]({})", path.to_string_lossy()));
    }
    out
}

/// Locate a usable pandoc. Kaelio does NOT bundle pandoc — users install it via
/// `brew install pandoc`. We check Homebrew (Apple Silicon + Intel) then PATH.
fn find_pandoc() -> Option<PathBuf> {
    let exe = if cfg!(target_os = "windows") {
        "pandoc.exe"
    } else {
        "pandoc"
    };
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/pandoc"),
        PathBuf::from("/usr/local/bin/pandoc"),
    ];
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            candidates.push(dir.join(exe));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// Locate Typst for Markdown PDF export. Passing an absolute path to pandoc
/// avoids Finder-launched app PATH quirks.
fn find_typst() -> Option<PathBuf> {
    let exe = if cfg!(target_os = "windows") {
        "typst.exe"
    } else {
        "typst"
    };
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/typst"),
        PathBuf::from("/usr/local/bin/typst"),
    ];
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            candidates.push(dir.join(exe));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

const PANDOC_MISSING_MSG: &str = "Pandoc is required for PDF/DOCX export but was not found. Install it with: brew install pandoc";
const TYPST_MISSING_MSG: &str = "Typst is required for Markdown PDF export but was not found. Install it with: brew install typst";
const PANDOC_MARKDOWN_INPUT_FORMAT: &str = "markdown+task_lists+pipe_tables+grid_tables+multiline_tables+simple_tables+table_captions+strikeout";
const TYPST_TABLE_HEADER: &str = "#set table(stroke: 0.5pt + luma(210), inset: 6pt)\n";

const DOCX_TABLE_STYLE: &str = r#"<w:style w:default="1" w:styleId="Table" w:type="table">
    <w:name w:val="Table" />
    <w:basedOn w:val="TableNormal" />
    <w:qFormat />
    <w:tblPr>
      <w:tblInd w:type="dxa" w:w="0" />
      <w:tblBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="D0D7DE" />
        <w:left w:val="single" w:sz="4" w:space="0" w:color="D0D7DE" />
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="D0D7DE" />
        <w:right w:val="single" w:sz="4" w:space="0" w:color="D0D7DE" />
        <w:insideH w:val="single" w:sz="4" w:space="0" w:color="D0D7DE" />
        <w:insideV w:val="single" w:sz="4" w:space="0" w:color="D0D7DE" />
      </w:tblBorders>
      <w:tblCellMar>
        <w:top w:type="dxa" w:w="96" />
        <w:left w:type="dxa" w:w="120" />
        <w:bottom w:type="dxa" w:w="96" />
        <w:right w:type="dxa" w:w="120" />
      </w:tblCellMar>
    </w:tblPr>
    <w:tblStylePr w:type="firstRow">
      <w:tcPr>
        <w:shd w:fill="F3F6FA" w:val="clear" />
        <w:vAlign w:val="center" />
      </w:tcPr>
      <w:rPr>
        <w:b />
      </w:rPr>
    </w:tblStylePr>
  </w:style>"#;

fn output_file_ready(path: &str) -> bool {
    fs::metadata(path)
        .map(|m| m.is_file() && m.len() > 0)
        .unwrap_or(false)
}

fn apply_kaelio_docx_table_style(styles_xml: &str) -> String {
    let Some(style_id) = styles_xml.find(r#"w:styleId="Table""#) else {
        return styles_xml.replacen(
            "</w:styles>",
            &format!("{}\n</w:styles>", DOCX_TABLE_STYLE),
            1,
        );
    };
    let Some(start) = styles_xml[..style_id].rfind("<w:style") else {
        return styles_xml.to_string();
    };
    let Some(end_rel) = styles_xml[style_id..].find("</w:style>") else {
        return styles_xml.to_string();
    };
    let end = style_id + end_rel + "</w:style>".len();

    let mut styled = String::with_capacity(styles_xml.len() + DOCX_TABLE_STYLE.len());
    styled.push_str(&styles_xml[..start]);
    styled.push_str(DOCX_TABLE_STYLE);
    styled.push_str(&styles_xml[end..]);
    styled
}

fn style_docx_tables(path: &Path) -> Result<(), String> {
    use std::io::{Read, Write};
    use zip::{ZipArchive, ZipWriter};

    let source = fs::File::open(path)
        .map_err(|e| format!("Failed to open DOCX for table styling: {}", e))?;
    let mut archive =
        ZipArchive::new(source).map_err(|e| format!("Failed to read DOCX package: {}", e))?;
    let tmp_path = path.with_file_name(format!(
        "{}.kaelio-tables.tmp",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("export.docx")
    ));
    let target =
        fs::File::create(&tmp_path).map_err(|e| format!("Failed to prepare styled DOCX: {}", e))?;
    let mut writer = ZipWriter::new(target);
    let mut updated_styles = false;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read DOCX entry: {}", e))?;
        if entry.name() == "word/styles.xml" {
            let options = entry.options();
            let mut styles_xml = String::new();
            entry
                .read_to_string(&mut styles_xml)
                .map_err(|e| format!("Failed to read DOCX styles: {}", e))?;
            let styled_xml = apply_kaelio_docx_table_style(&styles_xml);
            updated_styles = styled_xml != styles_xml;
            writer
                .start_file("word/styles.xml", options)
                .map_err(|e| format!("Failed to write DOCX styles: {}", e))?;
            writer
                .write_all(styled_xml.as_bytes())
                .map_err(|e| format!("Failed to write DOCX table style: {}", e))?;
        } else {
            writer
                .raw_copy_file(entry)
                .map_err(|e| format!("Failed to copy DOCX entry: {}", e))?;
        }
    }

    writer
        .finish()
        .map_err(|e| format!("Failed to finalize styled DOCX: {}", e))?;
    drop(archive);

    if updated_styles {
        if cfg!(target_os = "windows") {
            fs::remove_file(path).map_err(|e| format!("Failed to replace original DOCX: {}", e))?;
        }
        fs::rename(&tmp_path, path).map_err(|e| format!("Failed to install styled DOCX: {}", e))?;
    } else {
        let _ = fs::remove_file(&tmp_path);
    }

    Ok(())
}

/// Pandoc arguments for Markdown -> PDF through Typst.
fn pandoc_pdf_args(input: &Path, output_path: &str, typst_path: &Path, typst_header: &Path) -> Vec<String> {
    let mut args = vec![
        input.to_string_lossy().to_string(),
        "-o".to_string(),
        output_path.to_string(),
        "--from".to_string(),
        // No raw blocks (```{=typst}): a note must not hand Typst code such as
        // `#read("/path")` that would copy local files into the PDF.
        format!("{PANDOC_MARKDOWN_INPUT_FORMAT}-raw_attribute"),
        "--pdf-engine".to_string(),
        typst_path.to_string_lossy().to_string(),
    ];
    // Given a full engine path, Pandoc copies images into an absolute temp media
    // folder but leaves Typst's root at the working directory, which Typst then
    // prefixes to the absolute path. Rooting Typst at `/` resolves those paths.
    // Safe only together with `-raw_attribute` above. Not verified on Windows.
    if !cfg!(target_os = "windows") {
        args.push("--pdf-engine-opt=--root=/".to_string());
    }
    args.extend([
        "--include-in-header".to_string(),
        typst_header.to_string_lossy().to_string(),
        "-V".to_string(),
        "geometry:margin=1in".to_string(),
        "-V".to_string(),
        "fontsize=11pt".to_string(),
        "-V".to_string(),
        "colorlinks=true".to_string(),
        "--syntax-highlighting=none".to_string(),
    ]);
    args
}

#[tauri::command]
async fn export_pdf(
    markdown_content: String,
    output_path: String,
    diagrams: Vec<DiagramImage>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    // Run all blocking work on a separate thread to avoid blocking async runtime
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let result = export_pdf_blocking(markdown_content, output_path, diagrams, app);
        let _ = tx.send(result);
    });
    rx.recv().map_err(|e| format!("Thread error: {}", e))?
}

fn export_pdf_blocking(
    markdown_content: String,
    output_path: String,
    diagrams: Vec<DiagramImage>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    use std::io::Write;
    use std::process::Command;

    let _ = app.emit("pdf-progress", "Preparing document…");

    // Replace emoji/symbols that fonts can't render with text equivalents
    let markdown_content = markdown_content
        .replace("❌", "[X]")
        .replace("✅", "[v]")
        .replace("✓", "[v]")
        .replace("⚠️", "[!]")
        .replace("📁", "[dir]")
        .replace('→', "->")
        .replace('←', "<-")
        .replace('↓', "v");

    let tmp_dir = unique_export_dir("kaelio_export");
    let _ = fs::create_dir_all(&tmp_dir);
    let tmp_input = tmp_dir.join("export.md");

    // Build PATH: inherit system PATH and append known Pandoc/Typst locations.
    let sys_path = std::env::var("PATH").unwrap_or_default();
    let path_env = if cfg!(target_os = "windows") {
        // Windows: append common Pandoc install location.
        let mut extra = format!("{};C:\\Program Files\\Pandoc", sys_path);
        // Also check %LOCALAPPDATA%\Pandoc (user-level MSI install)
        if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
            extra = format!("{};{}\\Pandoc", extra, local_app);
        }
        extra
    } else {
        // macOS/Linux: add Homebrew (Apple Silicon + Intel) and common bin paths.
        let mut extra = format!(
            "{}:/opt/homebrew/bin:/opt/anaconda3/bin:/usr/local/bin:/usr/bin:/bin",
            sys_path
        );
        // Also check ~/.local/bin (pip/pipx installs on Linux)
        if let Ok(home) = std::env::var("HOME") {
            extra = format!("{}:{}/bin:{}/.local/bin", extra, home, home);
        }
        extra
    };
    let pandoc_path = match find_pandoc() {
        Some(p) => p,
        None => {
            let _ = fs::remove_dir_all(&tmp_dir);
            return Err(PANDOC_MISSING_MSG.to_string());
        }
    };

    // Step 1: Mermaid diagrams were rendered locally by the frontend; write them and
    // point the placeholders at them. Nothing leaves the machine.
    if !diagrams.is_empty() {
        let _ = app.emit("pdf-progress", "Writing diagrams…");
    }
    let written = match write_diagrams(&tmp_dir, &diagrams) {
        Ok(w) => w,
        Err(e) => {
            let _ = fs::remove_dir_all(&tmp_dir);
            return Err(e);
        }
    };
    let processed = link_diagrams(&markdown_content, &written);

    // Step 2: Write processed input
    let mut f = fs::File::create(&tmp_input).map_err(|e| e.to_string())?;
    f.write_all(processed.as_bytes())
        .map_err(|e| e.to_string())?;
    let typst_header = tmp_dir.join("kaelio-tables.typ");
    let mut header = fs::File::create(&typst_header).map_err(|e| e.to_string())?;
    header
        .write_all(TYPST_TABLE_HEADER.as_bytes())
        .map_err(|e| e.to_string())?;

    // Step 3: Run pandoc with Typst. Kaelio's supported lightweight PDF stack is
    // `brew install pandoc` + `brew install typst`; do not fall through to
    // pdflatex/xelatex because that turns a Typst/PATH issue into a misleading
    // MacTeX error.
    let typst_path = match find_typst() {
        Some(p) => p,
        None => {
            let _ = fs::remove_dir_all(&tmp_dir);
            return Err(TYPST_MISSING_MSG.to_string());
        }
    };
    let _ = app.emit("pdf-progress", "Running pandoc (typst)…");

    let args = pandoc_pdf_args(&tmp_input, &output_path, &typst_path, &typst_header);

    let pandoc_program = pandoc_path.to_string_lossy().to_string();
    let mut pandoc_command = Command::new(&pandoc_path);
    force_fork_exec(&mut pandoc_command);
    let output = pandoc_command
        .args(&args)
        // Pandoc 3.10 writes the temporary Typst source to `.`; packaged apps
        // launched by Finder can start in `/`, which is read-only on macOS.
        .current_dir(&tmp_dir)
        .env("PATH", &path_env)
        .env("PWD", &tmp_dir)
        .env("TMPDIR", &tmp_dir)
        .stdin(std::process::Stdio::null())
        .output();
    let result = match output {
        Ok(out) if out.status.success() && output_file_ready(&output_path) => Ok(output_path),
        Ok(out) if out.status.success() => Err(format!(
            "pandoc finished, but the output file was not created or is empty: {}",
            output_path
        )),
        Ok(out) => {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            Err(format!(
                "pandoc failed: {}",
                if err.is_empty() {
                    format!("exited with {}", out.status)
                } else {
                    err
                }
            ))
        }
        Err(e) => Err(format!(
            "Failed to run pandoc at '{}'. ({}) [{}]",
            pandoc_program,
            e,
            spawn_diagnostic()
        )),
    };
    let _ = fs::remove_dir_all(&tmp_dir);
    result
}

#[tauri::command]
async fn export_docx(
    markdown_content: String,
    output_path: String,
    diagrams: Vec<DiagramImage>,
    _app: tauri::AppHandle,
) -> Result<String, String> {
    use std::io::Write;

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let result = (|| -> Result<String, String> {
            let tmp_dir = unique_export_dir("kaelio_export_docx");
            let _ = fs::create_dir_all(&tmp_dir);
            let tmp_md = tmp_dir.join("export.md");

            // Mermaid diagrams arrive pre-rendered from the frontend (no network).
            let written = match write_diagrams(&tmp_dir, &diagrams) {
                Ok(w) => w,
                Err(e) => {
                    let _ = fs::remove_dir_all(&tmp_dir);
                    return Err(e);
                }
            };
            let markdown_content = link_diagrams(&markdown_content, &written);

            let mut f = fs::File::create(&tmp_md).map_err(|e| e.to_string())?;
            f.write_all(markdown_content.as_bytes())
                .map_err(|e| e.to_string())?;

            let sys_path = std::env::var("PATH").unwrap_or_default();
            let path_env = if cfg!(target_os = "windows") {
                let mut extra = format!("{};C:\\Program Files\\Pandoc", sys_path);
                if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
                    extra = format!("{};{}\\Pandoc", extra, local_app);
                }
                extra
            } else {
                let mut extra = format!(
                    "{}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
                    sys_path
                );
                if let Ok(home) = std::env::var("HOME") {
                    extra = format!("{}:{}/bin:{}/.local/bin", extra, home, home);
                }
                extra
            };
            let pandoc_path = find_pandoc().ok_or_else(|| PANDOC_MISSING_MSG.to_string())?;

            let pandoc_program = pandoc_path.to_string_lossy().to_string();
            let mut pandoc_command = Command::new(&pandoc_path);
            force_fork_exec(&mut pandoc_command);
            let output = pandoc_command
                .args([
                    tmp_md.to_str().unwrap(),
                    "-o",
                    &output_path,
                    "--from",
                    PANDOC_MARKDOWN_INPUT_FORMAT,
                    "--to",
                    "docx",
                ])
                .current_dir(&tmp_dir)
                .env("PATH", &path_env)
                .env("PWD", &tmp_dir)
                .env("TMPDIR", &tmp_dir)
                .stdin(std::process::Stdio::null())
                .output();
            let result = match output {
                Ok(out) if out.status.success() && output_file_ready(&output_path) => {
                    style_docx_tables(Path::new(&output_path))?;
                    Ok(output_path.clone())
                }
                Ok(out) if out.status.success() => Err(format!(
                    "pandoc finished, but the output file was not created or is empty: {}",
                    output_path
                )),
                Ok(out) => {
                    let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
                    Err(format!(
                        "pandoc failed: {}",
                        if err.is_empty() {
                            format!("exited with {}", out.status)
                        } else {
                            err
                        }
                    ))
                }
                Err(e) => Err(format!(
                    "Failed to run pandoc at '{}'. ({}) [{}]",
                    pandoc_program,
                    e,
                    spawn_diagnostic()
                )),
            };
            let _ = fs::remove_dir_all(&tmp_dir);
            result
        })();
        let _ = tx.send(result);
    });
    rx.recv().map_err(|e| format!("Thread error: {}", e))?
}

#[tauri::command]
fn duplicate_entry(path: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err("Source path does not exist".to_string());
    }
    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = src
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let parent = src.parent().ok_or("Cannot determine parent directory")?;

    // Find a unique name with -copy, -copy-2, -copy-3, etc.
    let mut dest = parent.join(format!("{}-copy{}", stem, ext));
    let mut counter = 2u32;
    while dest.exists() {
        dest = parent.join(format!("{}-copy-{}{}", stem, counter, ext));
        counter += 1;
    }

    if src.is_dir() {
        fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
            fs::create_dir(dst).map_err(|e| e.to_string())?;
            for entry in fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
                let target = dst.join(entry.file_name());
                if entry.path().is_dir() {
                    copy_dir(&entry.path(), &target)?;
                } else {
                    fs::copy(&entry.path(), &target).map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        }
        copy_dir(&src, &dest)?;
    } else {
        fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    }

    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    use std::process::Command;
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("Path does not exist".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", &path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let parent = p
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        Command::new("xdg-open")
            .arg(&parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn load_custom_css() -> Result<String, String> {
    let path = kaelio_home()?.join("preview.css");
    if path.exists() {
        std::fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
fn create_window(app: tauri::AppHandle, file_path: Option<String>) -> Result<(), String> {
    let label = format!(
        "kaelio-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let label_clone = label.clone();

    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
        .title("Kaelio")
        .inner_size(1200.0, 800.0)
        .build()
        .map_err(|e| e.to_string())?;

    // If a file path was provided, emit open-file to the new window after it initializes
    if let Some(path) = file_path {
        let handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(500));
            if let Some(win) = handle.get_webview_window(&label_clone) {
                let _ = win.emit("open-file", path);
            }
        });
    }

    Ok(())
}

#[tauri::command]
fn watch_file(path: String, window: tauri::Window) -> Result<(), String> {
    let mut watchers_lock = FILE_WATCHERS.lock().unwrap_or_else(|e| e.into_inner());
    let watchers = watchers_lock.get_or_insert_with(HashMap::new);
    let label = window.label().to_string();

    // Create a new watcher that emits to this specific window
    let watched_path = PathBuf::from(&path);
    let watched_name = watched_path.file_name().map(|n| n.to_os_string());
    let watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| match res {
            Ok(event) => match event.kind {
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_) => {
                    emit_paths_changed(&window, &event.paths);
                    let dominated = event.paths.iter().any(|p| {
                        p == &watched_path
                            || p.file_name().map(|n| n.to_os_string()) == watched_name
                    });
                    if dominated {
                        let _ =
                            window.emit("file-changed", watched_path.to_string_lossy().to_string());
                    }
                }
                _ => {}
            },
            Err(e) => eprintln!("[kaelio] file watcher error: {}", e),
        },
        notify::Config::default(),
    )
    .map_err(|e| e.to_string())?;

    // Drop old watcher for this window safely
    if let Some(old) = watchers.remove(&label) {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || drop(old)));
    }
    watchers.insert(label.clone(), watcher);

    // Watch the file's parent directory (more reliable than watching the file directly)
    if let Some(parent) = Path::new(&path).parent() {
        watchers
            .get_mut(&label)
            .unwrap()
            .watch(parent, RecursiveMode::NonRecursive)
            .map_err(|e| e.to_string())?;
        // Pasted images live in assets/ beside the note; watch it too so the
        // preview drops a replaced image even when no folder is open.
        let assets = parent.join("assets");
        if assets.is_dir() {
            let _ = watchers
                .get_mut(&label)
                .unwrap()
                .watch(&assets, RecursiveMode::NonRecursive);
        }
    }

    Ok(())
}

/// Tells the frontend which paths changed on disk (the preview's local image
/// cache drops them). Paths inside `.git` are left out.
fn emit_paths_changed(window: &tauri::Window, paths: &[PathBuf]) {
    let list: Vec<String> = paths
        .iter()
        .filter(|p| !p.components().any(|c| c.as_os_str() == ".git"))
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    if !list.is_empty() {
        let _ = window.emit("paths-changed", list);
    }
}

#[tauri::command]
fn unwatch_file(window: tauri::Window) -> Result<(), String> {
    let mut watchers_lock = FILE_WATCHERS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(watchers) = watchers_lock.as_mut() {
        if let Some(watcher) = watchers.remove(window.label()) {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || drop(watcher)));
        }
    }
    Ok(())
}

#[tauri::command]
fn watch_folder(path: String, window: tauri::Window) -> Result<(), String> {
    let mut watchers_lock = FOLDER_WATCHERS.lock().unwrap_or_else(|e| e.into_inner());
    let watchers = watchers_lock.get_or_insert_with(HashMap::new);
    let label = window.label().to_string();

    let watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            match res {
                Ok(event) => {
                    // Ignore changes inside .git directory
                    let dominated_by_git = event
                        .paths
                        .iter()
                        .any(|p| p.components().any(|c| c.as_os_str() == ".git"));
                    if dominated_by_git {
                        return;
                    }
                    if !matches!(event.kind, EventKind::Access(_)) {
                        emit_paths_changed(&window, &event.paths);
                        let _ = window.emit("folder-changed", ());
                    }
                }
                Err(e) => eprintln!("[kaelio] folder watcher error: {}", e),
            }
        },
        notify::Config::default(),
    )
    .map_err(|e| e.to_string())?;

    if let Some(old) = watchers.remove(&label) {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || drop(old)));
    }
    watchers.insert(label.clone(), watcher);

    watchers
        .get_mut(&label)
        .unwrap()
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn unwatch_folder(window: tauri::Window) -> Result<(), String> {
    let mut watchers_lock = FOLDER_WATCHERS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(watchers) = watchers_lock.as_mut() {
        if let Some(watcher) = watchers.remove(window.label()) {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || drop(watcher)));
        }
    }
    Ok(())
}

// --- Git integration ---

/// Try system git credential helpers (works with macOS Keychain, Windows Credential Manager,
/// gh auth, Git Credential Manager, etc.) for HTTPS URLs.
fn try_git_credential_fill(url: &str) -> Option<(String, String)> {
    let input = format!(
        "protocol=https\nhost={}\n\n",
        url.trim_start_matches("https://")
            .trim_start_matches("http://")
            .split('/')
            .next()
            .unwrap_or("github.com")
    );
    let child = std::process::Command::new("git")
        .args(["credential", "fill"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    use std::io::Write;
    let mut child = child;
    child.stdin.take()?.write_all(input.as_bytes()).ok()?;
    let output = child.wait_with_output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut user = None;
    let mut pass = None;
    for line in stdout.lines() {
        if let Some(v) = line.strip_prefix("username=") {
            user = Some(v.to_string());
        }
        if let Some(v) = line.strip_prefix("password=") {
            pass = Some(v.to_string());
        }
    }
    match (user, pass) {
        (Some(u), Some(p)) => Some((u, p)),
        _ => None,
    }
}

/// libgit2 calls the credential callback again every time the server rejects
/// what it was given. `attempt` (1-based, counted by the caller) makes each call
/// offer the next option and then give up, instead of offering the same
/// rejected credential forever.
const GIT_CRED_MAX_ATTEMPTS: u32 = 4;

fn git_cred_callback(
    url: &str,
    username: Option<&str>,
    allowed: CredentialType,
    attempt: u32,
) -> Result<Cred, git2::Error> {
    let auth_failed = || {
        git2::Error::from_str(
            "Authentication failed. Make sure you're signed in to GitHub (try: gh auth login or add an SSH key).",
        )
    };
    if attempt > GIT_CRED_MAX_ATTEMPTS {
        return Err(auth_failed());
    }
    let user = username.unwrap_or("git");

    // 1. SSH credentials: the agent first, then one key file per later attempt.
    if allowed.contains(CredentialType::SSH_KEY) {
        if attempt == 1 {
            if let Ok(cred) = Cred::ssh_key_from_agent(user) {
                return Ok(cred);
            }
        }
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_default();
        let ssh_dir = PathBuf::from(&home).join(".ssh");
        let key_paths: Vec<PathBuf> = ["id_ed25519", "id_rsa"]
            .iter()
            .map(|name| ssh_dir.join(name))
            .filter(|path| path.exists())
            .collect();
        let key_index = attempt.saturating_sub(2) as usize;
        for key_path in key_paths.iter().skip(key_index) {
            let pub_path = PathBuf::from(format!("{}.pub", key_path.to_string_lossy()));
            let pub_key = pub_path.exists().then_some(pub_path.as_path());
            if let Ok(cred) = Cred::ssh_key(user, pub_key, key_path, None) {
                return Ok(cred);
            }
        }
        return Err(auth_failed());
    }

    // 2. HTTPS credentials via system git credential helpers. The helper returns
    // the same answer every time, so a second request means it was rejected.
    if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
        if attempt > 1 {
            return Err(auth_failed());
        }
        if let Some((u, p)) = try_git_credential_fill(url) {
            return Cred::userpass_plaintext(&u, &p);
        }
    }

    // 3. Default (e.g. system-level)
    if allowed.contains(CredentialType::DEFAULT) {
        return Cred::default();
    }
    Err(git2::Error::from_str(
        "Could not connect. Make sure you're signed in to GitHub (try: gh auth login or add an SSH key).",
    ))
}

#[tauri::command]
fn git_repo_info(folder_path: String) -> Result<GitRepoInfo, String> {
    let repo = match Repository::discover(&folder_path) {
        Ok(r) => r,
        Err(_) => {
            return Ok(GitRepoInfo {
                is_repo: false,
                branch: String::new(),
                remote_url: None,
                ahead: 0,
                behind: 0,
            });
        }
    };
    let branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_else(|| "HEAD".to_string());

    let remote_url = repo
        .find_remote("origin")
        .ok()
        .and_then(|r| r.url().map(|u| u.to_string()));

    let (ahead, behind) = (|| -> Result<(usize, usize), git2::Error> {
        let head = repo
            .head()?
            .target()
            .ok_or_else(|| git2::Error::from_str("no HEAD"))?;
        let branch_name = repo.head()?.shorthand().unwrap_or("main").to_string();
        let upstream_name = format!("refs/remotes/origin/{}", branch_name);
        let upstream = repo.refname_to_id(&upstream_name)?;
        Ok(repo.graph_ahead_behind(head, upstream)?)
    })()
    .unwrap_or((0, 0));

    Ok(GitRepoInfo {
        is_repo: true,
        branch,
        remote_url,
        ahead,
        behind,
    })
}

#[tauri::command]
fn git_status(folder_path: String) -> Result<Vec<GitFileStatus>, String> {
    let repo = Repository::discover(&folder_path).map_err(|e| e.to_string())?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);
    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let s = entry.status();
        let status = if s.contains(git2::Status::CONFLICTED) {
            "conflict"
        } else if s.contains(git2::Status::INDEX_NEW)
            || s.contains(git2::Status::INDEX_MODIFIED)
            || s.contains(git2::Status::INDEX_DELETED)
        {
            if s.contains(git2::Status::WT_MODIFIED) {
                "staged_modified"
            } else {
                "staged"
            }
        } else if s.contains(git2::Status::WT_NEW) {
            "new"
        } else if s.contains(git2::Status::WT_MODIFIED) {
            "modified"
        } else if s.contains(git2::Status::WT_DELETED) {
            "deleted"
        } else {
            continue;
        };
        result.push(GitFileStatus {
            path,
            status: status.to_string(),
        });
    }
    Ok(result)
}

#[tauri::command]
fn git_diff_file(folder_path: String, file_path: String) -> Result<GitDiffResult, String> {
    let repo = Repository::discover(&folder_path).map_err(|e| e.to_string())?;
    let workdir = repo.workdir().ok_or("No workdir")?.to_path_buf();
    let rel_path = PathBuf::from(&file_path)
        .strip_prefix(&workdir)
        .unwrap_or(Path::new(&file_path))
        .to_path_buf();

    // Get old content from HEAD
    let old_content = (|| -> Result<String, git2::Error> {
        let head = repo.head()?.peel_to_tree()?;
        let entry = head.get_path(&rel_path)?;
        let blob = repo.find_blob(entry.id())?;
        Ok(String::from_utf8_lossy(blob.content()).to_string())
    })()
    .unwrap_or_default();

    // Get new content from workdir
    let abs_path = workdir.join(&rel_path);
    let new_content = fs::read_to_string(&abs_path).unwrap_or_default();

    // Generate patch
    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.pathspec(&rel_path);
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let diff = repo
        .diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut diff_opts))
        .map_err(|e| e.to_string())?;
    let mut patch = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        if origin == '+' || origin == '-' || origin == ' ' {
            patch.push(origin);
        }
        patch.push_str(&String::from_utf8_lossy(line.content()));
        true
    })
    .map_err(|e| e.to_string())?;

    Ok(GitDiffResult {
        old_content,
        new_content,
        patch,
    })
}

#[tauri::command]
fn git_log(
    folder_path: String,
    file_path: Option<String>,
    limit: usize,
) -> Result<Vec<GitLogEntry>, String> {
    let repo = Repository::discover(&folder_path).map_err(|e| e.to_string())?;
    let workdir = repo.workdir().ok_or("No workdir")?.to_path_buf();
    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push_head().map_err(|e| e.to_string())?;
    revwalk
        .set_sorting(git2::Sort::TIME)
        .map_err(|e| e.to_string())?;

    let rel_path = file_path.as_ref().map(|fp| {
        let fp_path = PathBuf::from(fp);
        fp_path
            .strip_prefix(&workdir)
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|_| PathBuf::from(fp))
    });

    let mut entries = Vec::new();
    for oid in revwalk {
        if entries.len() >= limit {
            break;
        }
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;

        // Filter by file path if specified
        if let Some(ref rp) = rel_path {
            let dominated = (|| -> Result<bool, git2::Error> {
                let tree = commit.tree()?;
                let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());
                let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;
                Ok(diff.deltas().any(|d| {
                    d.new_file().path() == Some(rp.as_path())
                        || d.old_file().path() == Some(rp.as_path())
                }))
            })()
            .unwrap_or(false);
            if !dominated {
                continue;
            }
        }

        let id = format!("{}", &oid.to_string()[..7]);
        let message = commit.message().unwrap_or("").trim().to_string();
        let author = commit.author().name().unwrap_or("").to_string();
        let timestamp = commit.time().seconds();
        entries.push(GitLogEntry {
            id,
            message,
            author,
            timestamp,
        });
    }
    Ok(entries)
}

#[tauri::command]
fn git_commit(folder_path: String, files: Vec<String>, message: String) -> Result<String, String> {
    let repo = Repository::discover(&folder_path).map_err(|e| e.to_string())?;
    let workdir = repo.workdir().ok_or("No workdir")?.to_path_buf();
    let mut index = repo.index().map_err(|e| e.to_string())?;

    if files.is_empty() {
        // Stage all modified/new files
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .map_err(|e| e.to_string())?;
    } else {
        for file in &files {
            let rel = PathBuf::from(file)
                .strip_prefix(&workdir)
                .unwrap_or(Path::new(file))
                .to_path_buf();
            index.add_path(&rel).map_err(|e| e.to_string())?;
        }
    }
    index.write().map_err(|e| e.to_string())?;

    let tree_oid = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;
    let sig = repo
        .signature()
        .or_else(|_| Signature::now("Kaelio", "kaelio@localhost"))
        .map_err(|e| e.to_string())?;
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent.as_ref().map(|p| vec![p]).unwrap_or_default();

    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(|e| e.to_string())?;
    Ok(oid.to_string())
}

#[tauri::command]
fn git_push(folder_path: String) -> Result<String, String> {
    let repo = Repository::discover(&folder_path).map_err(|e| e.to_string())?;
    let branch = repo
        .head()
        .map_err(|e| e.to_string())?
        .shorthand()
        .unwrap_or("main")
        .to_string();
    let mut remote = repo.find_remote("origin").map_err(|e| e.to_string())?;
    let mut callbacks = git2::RemoteCallbacks::new();
    let mut cred_attempts = 0u32;
    callbacks.credentials(move |url, username, allowed| {
        cred_attempts += 1;
        git_cred_callback(url, username, allowed, cred_attempts)
    });
    let mut push_opts = git2::PushOptions::new();
    push_opts.remote_callbacks(callbacks);
    let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);
    remote
        .push(&[&refspec], Some(&mut push_opts))
        .map_err(|e| e.to_string())?;
    Ok(format!("Pushed to origin/{}", branch))
}

#[tauri::command]
fn git_pull(folder_path: String) -> Result<GitSyncResult, String> {
    let repo = Repository::discover(&folder_path).map_err(|e| e.to_string())?;
    let branch_name = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_else(|| "main".to_string());

    // Fetch
    let mut remote = repo.find_remote("origin").map_err(|e| e.to_string())?;
    let mut callbacks = git2::RemoteCallbacks::new();
    let mut cred_attempts = 0u32;
    callbacks.credentials(move |url, username, allowed| {
        cred_attempts += 1;
        git_cred_callback(url, username, allowed, cred_attempts)
    });
    let mut fetch_opts = git2::FetchOptions::new();
    fetch_opts.remote_callbacks(callbacks);
    remote
        .fetch(&[&branch_name], Some(&mut fetch_opts), None)
        .map_err(|e| e.to_string())?;
    drop(remote);

    // Merge (fast-forward preferred)
    let fetch_head = repo
        .find_reference("FETCH_HEAD")
        .map_err(|e| e.to_string())?;
    let fetch_commit = repo
        .reference_to_annotated_commit(&fetch_head)
        .map_err(|e| e.to_string())?;
    let (analysis, _) = repo
        .merge_analysis(&[&fetch_commit])
        .map_err(|e| e.to_string())?;

    if analysis.is_up_to_date() {
        return Ok(GitSyncResult {
            committed: false,
            pushed: false,
            pulled: true,
            message: "Already up to date".to_string(),
            conflicts: vec![],
        });
    }

    if analysis.is_fast_forward() {
        let refname = format!("refs/heads/{}", branch_name);
        // Update the working tree first, in safe mode: files with local changes
        // that the incoming commit also touches make this fail, and nothing has
        // been moved yet. A forced checkout here silently discarded those edits.
        let target = repo
            .find_object(fetch_commit.id(), None)
            .map_err(|e| e.to_string())?;
        repo.checkout_tree(&target, Some(git2::build::CheckoutBuilder::new().safe()))
            .map_err(|e| {
                format!(
                    "Pull stopped: local changes would be overwritten. Commit or discard them, then pull again. ({})",
                    e.message()
                )
            })?;
        let mut reference = repo.find_reference(&refname).map_err(|e| e.to_string())?;
        reference
            .set_target(fetch_commit.id(), "fast-forward pull")
            .map_err(|e| e.to_string())?;
        repo.set_head(&refname).map_err(|e| e.to_string())?;
        return Ok(GitSyncResult {
            committed: false,
            pushed: false,
            pulled: true,
            message: "Fast-forward pull".to_string(),
            conflicts: vec![],
        });
    }

    // Normal merge
    repo.merge(&[&fetch_commit], None, None)
        .map_err(|e| e.to_string())?;
    let index = repo.index().map_err(|e| e.to_string())?;
    if index.has_conflicts() {
        let conflicts: Vec<String> = index
            .conflicts()
            .map_err(|e| e.to_string())?
            .filter_map(|c| c.ok())
            .filter_map(|c| c.our.map(|e| String::from_utf8_lossy(&e.path).to_string()))
            .collect();
        return Ok(GitSyncResult {
            committed: false,
            pushed: false,
            pulled: true,
            message: format!("Conflicts in {} files", conflicts.len()),
            conflicts,
        });
    }

    // Auto-commit the merge
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_oid = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;
    let sig = repo
        .signature()
        .or_else(|_| Signature::now("Kaelio", "kaelio@localhost"))
        .map_err(|e| e.to_string())?;
    let head_commit = repo
        .head()
        .map_err(|e| e.to_string())?
        .peel_to_commit()
        .map_err(|e| e.to_string())?;
    let fetch_commit_obj = repo
        .find_commit(fetch_commit.id())
        .map_err(|e| e.to_string())?;
    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        "Merge remote changes",
        &tree,
        &[&head_commit, &fetch_commit_obj],
    )
    .map_err(|e| e.to_string())?;
    repo.cleanup_state().map_err(|e| e.to_string())?;

    Ok(GitSyncResult {
        committed: true,
        pushed: false,
        pulled: true,
        message: "Merged remote changes".to_string(),
        conflicts: vec![],
    })
}

#[tauri::command]
fn git_auto_sync(folder_path: String, file_path: String) -> Result<GitSyncResult, String> {
    let repo = Repository::discover(&folder_path).map_err(|e| e.to_string())?;
    let workdir = repo.workdir().ok_or("No workdir")?.to_path_buf();
    let rel_path = PathBuf::from(&file_path)
        .strip_prefix(&workdir)
        .unwrap_or(Path::new(&file_path))
        .to_path_buf();
    let filename = rel_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());

    // Stage the file
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index.add_path(&rel_path).map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;

    // Check if there are actually staged changes
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let diff = repo
        .diff_tree_to_index(head_tree.as_ref(), Some(&index), None)
        .map_err(|e| e.to_string())?;
    if diff.deltas().count() == 0 {
        return Ok(GitSyncResult {
            committed: false,
            pushed: false,
            pulled: false,
            message: "No changes to commit".to_string(),
            conflicts: vec![],
        });
    }

    // Commit
    let tree_oid = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;
    let sig = repo
        .signature()
        .or_else(|_| Signature::now("Kaelio", "kaelio@localhost"))
        .map_err(|e| e.to_string())?;
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent.as_ref().map(|p| vec![p]).unwrap_or_default();
    let message = format!("Update {}", filename);
    repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(|e| e.to_string())?;

    // Try to push (non-fatal if fails)
    let pushed = (|| -> Result<bool, String> {
        let branch = repo
            .head()
            .map_err(|e| e.to_string())?
            .shorthand()
            .unwrap_or("main")
            .to_string();
        let mut remote = repo.find_remote("origin").map_err(|e| e.to_string())?;
        let mut callbacks = git2::RemoteCallbacks::new();
        let mut cred_attempts = 0u32;
        callbacks.credentials(move |url, username, allowed| {
            cred_attempts += 1;
            git_cred_callback(url, username, allowed, cred_attempts)
        });
        let mut push_opts = git2::PushOptions::new();
        push_opts.remote_callbacks(callbacks);
        let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);
        remote
            .push(&[&refspec], Some(&mut push_opts))
            .map_err(|e| e.to_string())?;
        Ok(true)
    })()
    .unwrap_or(false);

    let msg = if pushed {
        format!("Synced: {}", message)
    } else {
        format!("Committed: {}", message)
    };

    Ok(GitSyncResult {
        committed: true,
        pushed,
        pulled: false,
        message: msg,
        conflicts: vec![],
    })
}

#[tauri::command]
fn git_init(folder_path: String) -> Result<(), String> {
    Repository::init(&folder_path).map_err(|e| e.to_string())?;
    Ok(())
}

/// One-click sync setup: init repo if needed, set remote, create .gitignore, initial commit
#[tauri::command]
fn git_setup_sync(folder_path: String, remote_url: String) -> Result<GitRepoInfo, String> {
    // Init if not a repo
    let repo = match Repository::discover(&folder_path) {
        Ok(r) => r,
        Err(_) => Repository::init(&folder_path).map_err(|e| e.to_string())?,
    };
    let workdir = repo.workdir().ok_or("No workdir")?.to_path_buf();
    // discover() walks upward. Setting up sync from a subfolder would rewrite the
    // parent repository's remote and commit and push everything in it.
    let same_dir = match (fs::canonicalize(&workdir), fs::canonicalize(&folder_path)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    };
    if !same_dir {
        return Err(format!(
            "This folder is inside an existing Git repository ({}). Open that folder to set up sync.",
            workdir.display()
        ));
    }

    // Create .gitignore if it doesn't exist
    let gitignore_path = workdir.join(".gitignore");
    if !gitignore_path.exists() {
        fs::write(&gitignore_path, ".DS_Store\nThumbs.db\nnode_modules/\n")
            .map_err(|e| e.to_string())?;
    }

    // Set or update remote
    if let Ok(remote) = repo.find_remote("origin") {
        let current_url = remote.url().unwrap_or("").to_string();
        if current_url != remote_url {
            drop(remote);
            repo.remote_set_url("origin", &remote_url)
                .map_err(|e| e.to_string())?;
        }
    } else {
        repo.remote("origin", &remote_url)
            .map_err(|e| e.to_string())?;
    }

    // Initial commit if repo is empty (no HEAD)
    if repo.head().is_err() {
        let mut index = repo.index().map_err(|e| e.to_string())?;
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .map_err(|e| e.to_string())?;
        index.write().map_err(|e| e.to_string())?;
        let tree_oid = index.write_tree().map_err(|e| e.to_string())?;
        let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;
        let sig = repo
            .signature()
            .or_else(|_| Signature::now("Kaelio", "kaelio@localhost"))
            .map_err(|e| e.to_string())?;
        repo.commit(Some("HEAD"), &sig, &sig, "Initial sync", &tree, &[])
            .map_err(|e| e.to_string())?;
    }

    // Try initial push to set up tracking
    let _ = (|| -> Result<(), String> {
        let branch = repo
            .head()
            .map_err(|e| e.to_string())?
            .shorthand()
            .unwrap_or("main")
            .to_string();
        let mut remote = repo.find_remote("origin").map_err(|e| e.to_string())?;
        let mut callbacks = git2::RemoteCallbacks::new();
        let mut cred_attempts = 0u32;
        callbacks.credentials(move |url, username, allowed| {
            cred_attempts += 1;
            git_cred_callback(url, username, allowed, cred_attempts)
        });
        let mut push_opts = git2::PushOptions::new();
        push_opts.remote_callbacks(callbacks);
        let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);
        remote
            .push(&[&refspec], Some(&mut push_opts))
            .map_err(|e| e.to_string())?;
        Ok(())
    })();

    // Return repo info
    git_repo_info(folder_path)
}

/// Check if system has working git credentials for a URL
#[tauri::command]
fn git_check_auth(remote_url: String) -> Result<bool, String> {
    // For SSH URLs, check if agent or key files exist
    if remote_url.starts_with("git@") || remote_url.contains("ssh://") {
        if Cred::ssh_key_from_agent("git").is_ok() {
            return Ok(true);
        }
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_default();
        let ssh_dir = PathBuf::from(&home).join(".ssh");
        for key in &["id_ed25519", "id_rsa"] {
            if ssh_dir.join(key).exists() {
                return Ok(true);
            }
        }
        return Ok(false);
    }
    // For HTTPS URLs, check system credential helper
    Ok(try_git_credential_fill(&remote_url).is_some())
}

#[tauri::command]
fn git_discard_file(folder_path: String, file_path: String) -> Result<(), String> {
    let repo = Repository::discover(&folder_path).map_err(|e| e.to_string())?;
    let workdir = repo.workdir().ok_or("No workdir")?.to_path_buf();
    let rel_path = PathBuf::from(&file_path)
        .strip_prefix(&workdir)
        .unwrap_or(Path::new(&file_path))
        .to_path_buf();
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.path(&rel_path).force();
    repo.checkout_head(Some(&mut checkout))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn git_stage_file(folder_path: String, file_path: String) -> Result<(), String> {
    let repo = Repository::discover(&folder_path).map_err(|e| e.to_string())?;
    let workdir = repo.workdir().ok_or("No workdir")?.to_path_buf();
    let rel_path = PathBuf::from(&file_path)
        .strip_prefix(&workdir)
        .unwrap_or(Path::new(&file_path))
        .to_path_buf();
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index.add_path(&rel_path).map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;
    Ok(())
}

/// Get content of a file at a specific commit
#[tauri::command]
fn git_file_at_commit(
    folder_path: String,
    file_path: String,
    commit_id: String,
) -> Result<String, String> {
    let repo = Repository::discover(&folder_path).map_err(|e| e.to_string())?;
    let workdir = repo.workdir().ok_or("No workdir")?.to_path_buf();
    let rel_path = PathBuf::from(&file_path)
        .strip_prefix(&workdir)
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|_| PathBuf::from(&file_path));
    // commit_id is hex from git_log, possibly abbreviated; reject anything else
    // so it cannot be read as a revision expression.
    if commit_id.len() < 4 || !commit_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid commit id".to_string());
    }
    let commit = repo
        .revparse_single(&commit_id)
        .and_then(|obj| obj.peel_to_commit())
        .map_err(|e| e.to_string())?;
    let tree = commit.tree().map_err(|e| e.to_string())?;
    let entry = tree
        .get_path(&rel_path)
        .map_err(|_| "File not found in this version".to_string())?;
    let blob = repo.find_blob(entry.id()).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(blob.content()).to_string())
}

/// Restore a file to its state at a specific commit
#[tauri::command]
fn git_restore_file(
    folder_path: String,
    file_path: String,
    commit_id: String,
) -> Result<(), String> {
    let content = git_file_at_commit(folder_path, file_path.clone(), commit_id)?;
    write_atomic(Path::new(&file_path), content.as_bytes())
}

/// Get conflict details for a file (local, remote, base content)
#[tauri::command]
fn git_conflict_info(folder_path: String, file_path: String) -> Result<GitConflictInfo, String> {
    let repo = Repository::discover(&folder_path).map_err(|e| e.to_string())?;
    let workdir = repo.workdir().ok_or("No workdir")?.to_path_buf();
    let rel_path_str = PathBuf::from(&file_path)
        .strip_prefix(&workdir)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| file_path.clone());
    let index = repo.index().map_err(|e| e.to_string())?;

    let mut base = String::new();
    let mut local = String::new();
    let mut remote = String::new();

    for conflict in index.conflicts().map_err(|e| e.to_string())? {
        let conflict = conflict.map_err(|e| e.to_string())?;
        let conflict_path = conflict
            .our
            .as_ref()
            .or(conflict.their.as_ref())
            .or(conflict.ancestor.as_ref())
            .map(|e| String::from_utf8_lossy(&e.path).to_string())
            .unwrap_or_default();
        if conflict_path != rel_path_str {
            continue;
        }

        if let Some(entry) = conflict.ancestor {
            if let Ok(blob) = repo.find_blob(entry.id) {
                base = String::from_utf8_lossy(blob.content()).to_string();
            }
        }
        if let Some(entry) = conflict.our {
            if let Ok(blob) = repo.find_blob(entry.id) {
                local = String::from_utf8_lossy(blob.content()).to_string();
            }
        }
        if let Some(entry) = conflict.their {
            if let Ok(blob) = repo.find_blob(entry.id) {
                remote = String::from_utf8_lossy(blob.content()).to_string();
            }
        }
        break;
    }

    // Fallback: if no index conflict entries, read workdir (may have conflict markers)
    if local.is_empty() && remote.is_empty() {
        let abs_path = workdir.join(&rel_path_str);
        local = fs::read_to_string(&abs_path).unwrap_or_default();
        remote = local.clone();
    }

    Ok(GitConflictInfo {
        path: rel_path_str,
        local_content: local,
        remote_content: remote,
        base_content: base,
    })
}

/// Resolve a conflict by writing chosen content and staging the file
#[tauri::command]
fn git_resolve_conflict(
    folder_path: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    fs::write(&file_path, &content).map_err(|e| e.to_string())?;
    git_stage_file(folder_path, file_path)
}

/// Save a snapshot of a file to ~/.kaelio/snapshots/
#[tauri::command]
fn save_snapshot(file_path: String, content: String) -> Result<(), String> {
    let snap_dir = kaelio_home()?.join("snapshots");
    fs::create_dir_all(&snap_dir).map_err(|e| e.to_string())?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let hash = format!("{:x}", md5_simple(&file_path));
    let filename = format!("{}_{}.snap", hash, timestamp);
    let snap_path = snap_dir.join(&filename);
    let header = format!("---mx-snapshot---\n{}\n{}\n---\n", file_path, timestamp);
    fs::write(&snap_path, format!("{}{}", header, content)).map_err(|e| e.to_string())?;

    // Cleanup old snapshots for this file (keep last 50)
    let prefix = format!("{}_", hash);
    let mut snaps: Vec<_> = fs::read_dir(&snap_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with(&prefix))
        .collect();
    snaps.sort_by_key(|e| e.file_name());
    if snaps.len() > 50 {
        for old in &snaps[..snaps.len() - 50] {
            let _ = fs::remove_file(old.path());
        }
    }
    Ok(())
}

fn md5_simple(input: &str) -> u64 {
    let mut hash: u64 = 0;
    for b in input.bytes() {
        hash = hash.wrapping_mul(31).wrapping_add(b as u64);
    }
    hash
}

#[derive(Serialize, Deserialize)]
struct SnapshotInfo {
    file_path: String,
    timestamp: u64,
    snap_path: String,
}

/// List snapshots for a file
#[tauri::command]
fn list_snapshots(file_path: String) -> Result<Vec<SnapshotInfo>, String> {
    let snap_dir = kaelio_home()?.join("snapshots");
    if !snap_dir.exists() {
        return Ok(vec![]);
    }
    let hash = format!("{:x}", md5_simple(&file_path));
    let prefix = format!("{}_", hash);
    let mut results: Vec<SnapshotInfo> = fs::read_dir(&snap_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with(&prefix))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let ts_str = name.strip_prefix(&prefix)?.strip_suffix(".snap")?;
            let timestamp: u64 = ts_str.parse().ok()?;
            Some(SnapshotInfo {
                file_path: file_path.clone(),
                timestamp,
                snap_path: e.path().to_string_lossy().to_string(),
            })
        })
        .collect();
    results.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(results)
}

/// Read snapshot content
#[tauri::command]
fn read_snapshot(snap_path: String) -> Result<String, String> {
    let raw = fs::read_to_string(&snap_path).map_err(|e| e.to_string())?;
    // Skip the header (4 lines: marker, path, timestamp, ---)
    let content = raw.splitn(2, "\n---\n").nth(1).unwrap_or(&raw);
    Ok(content.to_string())
}

#[tauri::command]
fn save_session(data: String) -> Result<(), String> {
    let path = kaelio_home()?.join("session.json");
    fs::write(&path, &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_session() -> Result<String, String> {
    let path = kaelio_home()?.join("session.json");
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok("{}".to_string())
    }
}

// --- kaelio-html scheme: opt-in scripts in HTML view (spec I3) ---
//
// A page in script mode runs in a frame with sandbox="allow-scripts" (never
// allow-same-origin) loaded from kaelio-html://localhost/<token>/<path>.
// Each token grants read access to one folder, the folder of the HTML file
// the user chose to run; nothing outside it is served.

/// (token, canonical folder), newest last. Revoked by html_revoke.
pub struct HtmlGrants(Mutex<Vec<(String, PathBuf)>>);

#[derive(Debug, Serialize)]
pub struct HtmlGrant {
    token: String,
    file_name: String,
}

fn new_html_token() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| format!("No randomness: {}", e))?;
    Ok(bytes.iter().map(|b| format!("{:02x}", b)).collect())
}

/// Grants the folder of an existing .html/.htm file under a fresh token.
fn grant_html(grants: &mut Vec<(String, PathBuf)>, path: &Path) -> Result<HtmlGrant, String> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    grant_html_in(grants, path, home.as_deref())
}

/// A page can load anything below its folder, so a page sitting directly in
/// the home folder or at the filesystem root is refused.
fn grant_html_in(
    grants: &mut Vec<(String, PathBuf)>,
    path: &Path,
    home: Option<&Path>,
) -> Result<HtmlGrant, String> {
    let canonical = fs::canonicalize(path).map_err(|_| "File not found".to_string())?;
    let meta = fs::metadata(&canonical).map_err(|_| "File not found".to_string())?;
    if !meta.is_file() {
        return Err("Not a file".to_string());
    }
    let ext = canonical
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if ext != "html" && ext != "htm" {
        return Err("Only HTML files can run scripts".to_string());
    }
    let folder = canonical.parent().ok_or("No parent folder")?.to_path_buf();
    let home = home.and_then(|h| fs::canonicalize(h).ok());
    if folder.parent().is_none() || home.as_deref() == Some(folder.as_path()) {
        return Err("Move the page into its own folder to run its scripts".to_string());
    }
    let file_name = canonical
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid file name")?
        .to_string();
    let token = new_html_token()?;
    // No cap: an evicted token would leave its open frame blank. The frontend
    // revokes a grant when its tab closes or scripts are turned off.
    grants.push((token.clone(), folder));
    Ok(HtmlGrant { token, file_name })
}

fn revoke_html(grants: &mut Vec<(String, PathBuf)>, token: &str) {
    grants.retain(|(t, _)| t != token);
}

/// Maps a scheme request path ("/<token>/<relative path>") to a file inside
/// the granted folder. 404: unknown token, missing file, not a file.
/// 403: empty or absolute relative path, NUL byte, or a path that resolves
/// (after "..", encoding and symlinks) outside the granted folder.
fn resolve_html_request(grants: &[(String, PathBuf)], url_path: &str) -> Result<PathBuf, u16> {
    let decoded = percent_encoding::percent_decode_str(url_path)
        .decode_utf8()
        .map_err(|_| 403u16)?;
    if decoded.contains('\0') {
        return Err(403);
    }
    let trimmed = decoded.strip_prefix('/').unwrap_or(&decoded);
    let (token, rest) = match trimmed.split_once('/') {
        Some((t, r)) => (t, r),
        None => (trimmed, ""),
    };
    let folder = grants
        .iter()
        .find(|(t, _)| t == token)
        .map(|(_, f)| f)
        .ok_or(404u16)?;
    if rest.is_empty() {
        return Err(403);
    }
    let rel = Path::new(rest);
    if rest.starts_with('/') || rest.starts_with('\\') || rel.is_absolute() || rel.has_root() {
        return Err(403);
    }
    // Hidden files and folders (.env, .git, …) are never served.
    if rest.split(['/', '\\']).any(|seg| seg.starts_with('.')) {
        return Err(403);
    }
    let resolved = fs::canonicalize(folder.join(rel)).map_err(|_| 404u16)?;
    let below = resolved.strip_prefix(folder).map_err(|_| 403u16)?;
    if below
        .components()
        .any(|c| c.as_os_str().to_string_lossy().starts_with('.'))
    {
        return Err(403);
    }
    if !resolved.is_file() {
        return Err(404);
    }
    Ok(resolved)
}

fn html_content_type(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css",
        "js" | "mjs" => "text/javascript",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        _ => "application/octet-stream",
    }
}

/// The CSP sent with every kaelio-html response. SELF is the scheme's own
/// origin as each platform's webview sees it. No 'unsafe-eval'.
fn html_scheme_csp() -> String {
    let own = if cfg!(windows) { "http://kaelio-html.localhost" } else { "kaelio-html:" };
    format!(
        "default-src 'none'; script-src 'unsafe-inline' https: {0}; style-src 'unsafe-inline' https: {0}; \
         img-src data: blob: https: {0}; font-src data: https: {0}; media-src https: {0}; \
         connect-src https: {0}; frame-src 'none'; form-action 'none'; base-uri 'none'",
        own
    )
}

fn html_scheme_response(
    grants: &HtmlGrants,
    method: &tauri::http::Method,
    url_path: &str,
) -> tauri::http::Response<Vec<u8>> {
    let status = |code: u16| {
        tauri::http::Response::builder()
            .status(code)
            .header("Cache-Control", "no-store")
            .body(Vec::new())
            .unwrap()
    };
    if method != tauri::http::Method::GET {
        return status(405);
    }
    let resolved = {
        let list = grants.0.lock().unwrap();
        resolve_html_request(&list, url_path)
    };
    let path = match resolved {
        Ok(p) => p,
        Err(code) => return status(code),
    };
    match fs::read(&path) {
        Ok(bytes) => tauri::http::Response::builder()
            .header("Content-Type", html_content_type(&path))
            .header("X-Content-Type-Options", "nosniff")
            .header("Cache-Control", "no-store")
            .header("Content-Security-Policy", html_scheme_csp())
            .body(bytes)
            .unwrap(),
        Err(_) => status(404),
    }
}

#[tauri::command]
fn html_grant(path: String, grants: tauri::State<'_, HtmlGrants>) -> Result<HtmlGrant, String> {
    let mut list = grants.0.lock().unwrap();
    grant_html(&mut list, Path::new(&path))
}

#[tauri::command]
fn html_revoke(token: String, grants: tauri::State<'_, HtmlGrants>) {
    let mut list = grants.0.lock().unwrap();
    revoke_html(&mut list, &token);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    ensure_std_fds();
    close_inherited_fds();
    raise_file_descriptor_limit();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(HtmlGrants(Mutex::new(Vec::new())))
        .register_uri_scheme_protocol("kaelio-html", |ctx, request| {
            let grants = ctx.app_handle().state::<HtmlGrants>();
            html_scheme_response(&grants, request.method(), request.uri().path())
        })
        .menu(|handle| {
            let app_menu = Submenu::with_items(
                handle,
                "Kaelio",
                true,
                &[
                    &PredefinedMenuItem::about(handle, Some("About Kaelio"), None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::hide(handle, Some("Hide Kaelio"))?,
                    &PredefinedMenuItem::hide_others(handle, Some("Hide Others"))?,
                    &PredefinedMenuItem::show_all(handle, Some("Show All"))?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::quit(handle, Some("Quit Kaelio"))?,
                ],
            )?;

            let export_menu = Submenu::with_items(
                handle,
                "Export",
                true,
                &[
                    &MenuItem::with_id(handle, "export.pdf", "PDF...", true, None::<&str>)?,
                    &MenuItem::with_id(handle, "export.docx", "DOCX...", true, None::<&str>)?,
                    &MenuItem::with_id(handle, "export.png", "PNG...", true, None::<&str>)?,
                ],
            )?;

            let file_menu = Submenu::with_items(
                handle,
                "File",
                true,
                &[
                    &MenuItem::with_id(handle, "file.new", "New File", true, Some("CmdOrCtrl+N"))?,
                    &MenuItem::with_id(
                        handle,
                        "file.open",
                        "Open File...",
                        true,
                        Some("CmdOrCtrl+O"),
                    )?,
                    &MenuItem::with_id(
                        handle,
                        "file.open-folder",
                        "Open Folder...",
                        true,
                        None::<&str>,
                    )?,
                    &MenuItem::with_id(
                        handle,
                        "file.new-window",
                        "New Window",
                        true,
                        Some("CmdOrCtrl+Shift+N"),
                    )?,
                    &PredefinedMenuItem::separator(handle)?,
                    &MenuItem::with_id(handle, "file.save", "Save", true, Some("CmdOrCtrl+S"))?,
                    &MenuItem::with_id(
                        handle,
                        "file.close-tab",
                        "Close Tab",
                        true,
                        Some("CmdOrCtrl+W"),
                    )?,
                    &PredefinedMenuItem::separator(handle)?,
                    &export_menu,
                ],
            )?;

            let edit_menu = Submenu::with_items(
                handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(handle, None)?,
                    &PredefinedMenuItem::redo(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::cut(handle, None)?,
                    &PredefinedMenuItem::copy(handle, None)?,
                    &PredefinedMenuItem::paste(handle, None)?,
                    &PredefinedMenuItem::select_all(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &MenuItem::with_id(
                        handle,
                        "edit.copy-formatted",
                        "Copy Formatted HTML",
                        true,
                        Some("CmdOrCtrl+Shift+C"),
                    )?,
                    &MenuItem::with_id(
                        handle,
                        "edit.copy-raw",
                        "Copy Raw Markdown",
                        true,
                        None::<&str>,
                    )?,
                    &MenuItem::with_id(
                        handle,
                        "edit.copy-plain",
                        "Copy Plain Text",
                        true,
                        None::<&str>,
                    )?,
                ],
            )?;

            let font_menu = Submenu::with_items(
                handle,
                "Font",
                true,
                &[
                    &MenuItem::with_id(handle, "font.system", "System", true, None::<&str>)?,
                    &MenuItem::with_id(handle, "font.inter", "Inter", true, None::<&str>)?,
                    &MenuItem::with_id(handle, "font.georgia", "Georgia", true, None::<&str>)?,
                    &MenuItem::with_id(
                        handle,
                        "font.merriweather",
                        "Merriweather",
                        true,
                        None::<&str>,
                    )?,
                    &MenuItem::with_id(
                        handle,
                        "font.jetbrains-mono",
                        "JetBrains Mono",
                        true,
                        None::<&str>,
                    )?,
                    &PredefinedMenuItem::separator(handle)?,
                    &MenuItem::with_id(handle, "font.custom", "Custom...", true, None::<&str>)?,
                ],
            )?;

            let text_size_menu = Submenu::with_items(
                handle,
                "Text Size",
                true,
                &[
                    &MenuItem::with_id(handle, "text-size.12", "12", true, None::<&str>)?,
                    &MenuItem::with_id(handle, "text-size.14", "14", true, None::<&str>)?,
                    &MenuItem::with_id(handle, "text-size.16", "16", true, None::<&str>)?,
                    &MenuItem::with_id(handle, "text-size.18", "18", true, None::<&str>)?,
                    &MenuItem::with_id(handle, "text-size.20", "20", true, None::<&str>)?,
                    &MenuItem::with_id(handle, "text-size.24", "24", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &MenuItem::with_id(
                        handle,
                        "text-size.custom",
                        "Custom...",
                        true,
                        None::<&str>,
                    )?,
                ],
            )?;

            let explorer_text_size_menu = Submenu::with_items(
                handle,
                "Explorer Text Size",
                true,
                &[
                    &MenuItem::with_id(handle, "explorer-size.12", "12", true, None::<&str>)?,
                    &MenuItem::with_id(handle, "explorer-size.13", "13", true, None::<&str>)?,
                    &MenuItem::with_id(handle, "explorer-size.14", "14", true, None::<&str>)?,
                    &MenuItem::with_id(handle, "explorer-size.15", "15", true, None::<&str>)?,
                    &MenuItem::with_id(handle, "explorer-size.16", "16", true, None::<&str>)?,
                    &MenuItem::with_id(handle, "explorer-size.18", "18", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &MenuItem::with_id(
                        handle,
                        "explorer-size.custom",
                        "Custom...",
                        true,
                        None::<&str>,
                    )?,
                ],
            )?;

            let theme_menu = Submenu::with_items(
                handle,
                "Theme",
                true,
                &[
                    &MenuItem::with_id(handle, "theme.auto", "System", true, None::<&str>)?,
                    &MenuItem::with_id(handle, "theme.light", "Light", true, None::<&str>)?,
                    &MenuItem::with_id(handle, "theme.dark", "Dark", true, None::<&str>)?,
                    &MenuItem::with_id(
                        handle,
                        "theme.catppuccin-mocha",
                        "Catppuccin Mocha",
                        true,
                        None::<&str>,
                    )?,
                    &MenuItem::with_id(
                        handle,
                        "theme.everforest-dark",
                        "Everforest Dark",
                        true,
                        None::<&str>,
                    )?,
                    &MenuItem::with_id(handle, "theme.nord", "Nord", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &MenuItem::with_id(handle, "theme.custom", "Custom...", true, None::<&str>)?,
                ],
            )?;

            let soft_wrap_menu = Submenu::with_items(
                handle,
                "Soft Wrap",
                true,
                &[
                    &MenuItem::with_id(handle, "view.soft-wrap.off", "Off", true, None::<&str>)?,
                    &MenuItem::with_id(
                        handle,
                        "view.soft-wrap.window",
                        "Window Width",
                        true,
                        None::<&str>,
                    )?,
                    &MenuItem::with_id(
                        handle,
                        "view.soft-wrap.column",
                        "Page Guide",
                        true,
                        None::<&str>,
                    )?,
                ],
            )?;

            let reading_width_menu = Submenu::with_items(
                handle,
                "Reading Width",
                true,
                &[
                    &MenuItem::with_id(handle, "view.reading-width.narrow", "Narrow", true, None::<&str>)?,
                    &MenuItem::with_id(handle, "view.reading-width.medium", "Medium", true, None::<&str>)?,
                    &MenuItem::with_id(handle, "view.reading-width.wide", "Wide", true, None::<&str>)?,
                    &MenuItem::with_id(handle, "view.reading-width.full", "Full", true, None::<&str>)?,
                ],
            )?;

            let view_menu = Submenu::with_items(
                handle,
                "View",
                true,
                &[
                    &MenuItem::with_id(
                        handle,
                        "view.explorer",
                        "Show/Hide Explorer",
                        true,
                        Some("CmdOrCtrl+B"),
                    )?,
                    &MenuItem::with_id(
                        handle,
                        "view.preview",
                        "Show/Hide Preview",
                        true,
                        Some("CmdOrCtrl+Alt+P"),
                    )?,
                    &MenuItem::with_id(
                        handle,
                        "view.reading",
                        "Reading View",
                        true,
                        Some("CmdOrCtrl+E"),
                    )?,
                    &MenuItem::with_id(
                        handle,
                        "view.line-numbers",
                        "Show/Hide Line Numbers",
                        true,
                        None::<&str>,
                    )?,
                    &soft_wrap_menu,
                    &reading_width_menu,
                    &PredefinedMenuItem::separator(handle)?,
                    &MenuItem::with_id(
                        handle,
                        "view.zoom-in",
                        "Zoom In",
                        true,
                        Some("CmdOrCtrl+="),
                    )?,
                    &MenuItem::with_id(
                        handle,
                        "view.zoom-out",
                        "Zoom Out",
                        true,
                        Some("CmdOrCtrl+-"),
                    )?,
                    &MenuItem::with_id(
                        handle,
                        "view.zoom-reset",
                        "Reset Zoom",
                        true,
                        Some("CmdOrCtrl+0"),
                    )?,
                    &PredefinedMenuItem::separator(handle)?,
                    &font_menu,
                    &text_size_menu,
                    &explorer_text_size_menu,
                    &theme_menu,
                ],
            )?;

            let search_menu = Submenu::with_items(
                handle,
                "Search",
                true,
                &[
                    &MenuItem::with_id(
                        handle,
                        "search.command-palette",
                        "Command Palette",
                        true,
                        Some("CmdOrCtrl+Shift+P"),
                    )?,
                    &MenuItem::with_id(
                        handle,
                        "search.file-search",
                        "File Search",
                        true,
                        Some("CmdOrCtrl+P"),
                    )?,
                    &MenuItem::with_id(
                        handle,
                        "search.content-search",
                        "Search in Files",
                        true,
                        Some("CmdOrCtrl+Shift+F"),
                    )?,
                ],
            )?;

            let window_menu = Submenu::with_items(
                handle,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(handle, None)?,
                    &PredefinedMenuItem::fullscreen(handle, Some("Enter Full Screen"))?,
                ],
            )?;

            let help_menu = Submenu::with_items(
                handle,
                "Help",
                true,
                &[
                    &MenuItem::with_id(handle, "help.guide", "Kaelio Guide", true, None::<&str>)?,
                    &MenuItem::with_id(
                        handle,
                        "help.shortcuts",
                        "Keyboard Shortcuts",
                        true,
                        Some("CmdOrCtrl+/"),
                    )?,
                    &MenuItem::with_id(
                        handle,
                        "help.customize-shortcuts",
                        "Customize Shortcuts",
                        true,
                        None::<&str>,
                    )?,
                    &PredefinedMenuItem::separator(handle)?,
                    &MenuItem::with_id(
                        handle,
                        "help.check-updates",
                        "Check for Updates...",
                        true,
                        None::<&str>,
                    )?,
                    &MenuItem::with_id(handle, "help.about", "About Kaelio", true, None::<&str>)?,
                ],
            )?;

            Menu::with_items(
                handle,
                &[
                    &app_menu,
                    &file_menu,
                    &edit_menu,
                    &view_menu,
                    &search_menu,
                    &window_menu,
                    &help_menu,
                ],
            )
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("native-menu-command", event.id().as_ref().to_string());
        })
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            // On Linux/Windows, file associations pass the path as a CLI arg
            #[cfg(not(any(target_os = "macos", target_os = "ios")))]
            {
                let args: Vec<String> = std::env::args().collect();
                if args.len() > 1 {
                    let path = &args[1];
                    if !path.starts_with('-') && Path::new(path).exists() {
                        *INITIAL_FILE.lock().unwrap() = Some(path.clone());
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            html_grant,
            html_revoke,
            read_file,
            read_binary_file,
            open_in_default_app,
            file_metadata,
            save_binary_base64,
            save_pasted_image,
            set_menu_accelerators,
            save_file,
            word_count,
            list_directory,
            get_home_dir,
            get_initial_file,
            export_pdf,
            export_docx,
            create_file,
            create_directory,
            copy_into_folder,
            delete_entry,
            rename_entry,
            list_files_recursive,
            save_recovery,
            get_recovery_files,
            read_recovery_content,
            delete_recovery,
            duplicate_entry,
            reveal_in_finder,
            load_custom_css,
            watch_file,
            unwatch_file,
            watch_folder,
            unwatch_folder,
            search_in_files,
            create_window,
            git_repo_info,
            git_status,
            git_diff_file,
            git_log,
            git_commit,
            git_push,
            git_pull,
            git_auto_sync,
            git_init,
            git_setup_sync,
            git_check_auth,
            git_discard_file,
            git_stage_file,
            git_file_at_commit,
            git_restore_file,
            git_conflict_info,
            git_resolve_conflict,
            save_snapshot,
            list_snapshots,
            read_snapshot,
            save_session,
            load_session
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = _event {
                let files: Vec<String> = urls
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .map(|p| p.to_string_lossy().to_string())
                    .collect();
                if let Some(path) = files.first() {
                    *INITIAL_FILE.lock().unwrap() = Some(path.clone());
                    // Emit to focused window if available, otherwise broadcast
                    let emitted = _app
                        .webview_windows()
                        .values()
                        .find(|w| w.is_focused().unwrap_or(false))
                        .map(|w| w.emit("open-file", path.clone()));
                    if emitted.is_none() {
                        let _ = _app.emit("open-file", path.clone());
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::natural_name_cmp;

    #[test]
    fn natural_name_cmp_sorts_numbered_names_by_numeric_value() {
        let mut names = vec![
            "10.salesforce",
            "2.gws",
            "0.man",
            "11.sisense",
            "9.azure",
            "1.okta",
        ];

        names.sort_by(|a, b| natural_name_cmp(a, b));

        assert_eq!(
            names,
            vec![
                "0.man",
                "1.okta",
                "2.gws",
                "9.azure",
                "10.salesforce",
                "11.sisense",
            ]
        );
    }
}

#[cfg(test)]
mod audit_tests {
    use super::*;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = unique_export_dir(&format!("kaelio_test_{}", name));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn word_count_counts_characters_not_bytes() {
        let count = word_count("héllo wörld\nxin chào".to_string());
        assert_eq!(count.chars, 20);
        assert_eq!(count.words, 4);
        assert_eq!(count.lines, 2);
    }

    #[test]
    fn write_atomic_replaces_content_and_leaves_no_temp_file() {
        let dir = scratch_dir("atomic");
        let file = dir.join("note.md");
        fs::write(&file, "old").unwrap();
        write_atomic(&file, b"new content").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "new content");
        let names: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["note.md".to_string()]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_atomic_fails_without_touching_anything_when_directory_is_missing() {
        let dir = scratch_dir("atomic_missing");
        let file = dir.join("no-such-dir").join("note.md");
        assert!(write_atomic(&file, b"x").is_err());
        assert!(!file.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn write_atomic_keeps_a_symlink_and_updates_its_target() {
        let dir = scratch_dir("atomic_link");
        let real = dir.join("real.md");
        let link = dir.join("link.md");
        fs::write(&real, "old").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        write_atomic(&link, b"new").unwrap();
        assert!(
            fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(fs::read_to_string(&real).unwrap(), "new");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn create_file_refuses_to_overwrite_an_existing_file() {
        let dir = scratch_dir("create");
        let file = dir.join("a.md");
        fs::write(&file, "keep me").unwrap();
        let err = create_file(file.to_string_lossy().to_string()).unwrap_err();
        assert!(err.contains("already exists"));
        assert_eq!(fs::read_to_string(&file).unwrap(), "keep me");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn git_file_at_commit_rejects_non_hex_revision_expressions() {
        let dir = scratch_dir("revspec");
        Repository::init(&dir).unwrap();
        let folder = dir.to_string_lossy().to_string();
        for bad in ["HEAD", "HEAD~1", "main", "abc", "-1", ""] {
            let result = git_file_at_commit(folder.clone(), "a.md".to_string(), bad.to_string());
            assert_eq!(result.unwrap_err(), "Invalid commit id", "input: {bad:?}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn credential_callback_gives_up_after_the_attempt_limit() {
        let result = git_cred_callback(
            "https://example.invalid/repo.git",
            None,
            CredentialType::USER_PASS_PLAINTEXT,
            GIT_CRED_MAX_ATTEMPTS + 1,
        );
        assert!(result.is_err());
    }

    #[test]
    fn export_scratch_directories_are_unique_per_call() {
        assert_ne!(unique_export_dir("x"), unique_export_dir("x"));
    }

    const PNG: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];

    fn note_in(dir: &Path) -> PathBuf {
        let note = dir.join("note.md");
        fs::write(&note, "# note").unwrap();
        note
    }

    #[test]
    fn pasted_image_is_written_under_assets_and_returns_relative_path() {
        let dir = scratch_dir("paste_ok");
        let note = note_in(&dir);
        let rel = save_pasted_image_impl(&note, PNG, "image/png", "20261116-073501").unwrap();
        assert_eq!(rel, "assets/pasted-20261116-073501.png");
        assert_eq!(fs::read(dir.join("assets/pasted-20261116-073501.png")).unwrap(), PNG);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pasted_image_collision_gets_numeric_suffix() {
        let dir = scratch_dir("paste_collide");
        let note = note_in(&dir);
        save_pasted_image_impl(&note, PNG, "image/png", "20261116-073501").unwrap();
        let mut other = PNG.to_vec();
        other.push(9);
        let rel = save_pasted_image_impl(&note, &other, "image/png", "20261116-073501").unwrap();
        assert_eq!(rel, "assets/pasted-20261116-073501-2.png");
        assert_eq!(fs::read(dir.join("assets/pasted-20261116-073501.png")).unwrap(), PNG);
        assert_eq!(fs::read(dir.join("assets/pasted-20261116-073501-2.png")).unwrap(), other);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pasted_image_rejects_unlisted_mime() {
        let dir = scratch_dir("paste_mime");
        let note = note_in(&dir);
        assert!(save_pasted_image_impl(&note, b"<svg/>", "image/svg+xml", "20261116-073501").is_err());
        assert!(!dir.join("assets").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pasted_image_rejects_bytes_that_do_not_match_mime() {
        let dir = scratch_dir("paste_magic");
        let note = note_in(&dir);
        assert!(save_pasted_image_impl(&note, b"<html>", "image/png", "20261116-073501").is_err());
        assert!(save_pasted_image_impl(&note, b"RIFF0000AVI ", "image/webp", "20261116-073501").is_err());
        assert!(!dir.join("assets").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pasted_image_rejects_oversize() {
        let dir = scratch_dir("paste_big");
        let note = note_in(&dir);
        let mut big = vec![0u8; 20 * 1024 * 1024 + 1];
        big[..PNG.len()].copy_from_slice(PNG);
        assert!(save_pasted_image_impl(&note, &big, "image/png", "20261116-073501").is_err());
        assert!(!dir.join("assets").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pasted_image_rejects_bad_stamp() {
        let dir = scratch_dir("paste_stamp");
        let note = note_in(&dir);
        assert!(save_pasted_image_impl(&note, PNG, "image/png", "../../x").is_err());
        assert!(save_pasted_image_impl(&note, PNG, "image/png", "2026").is_err());
        assert!(!dir.join("assets").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pasted_image_rejects_missing_note() {
        let dir = scratch_dir("paste_missing");
        let note = dir.join("missing.md");
        assert!(save_pasted_image_impl(&note, PNG, "image/png", "20261116-073501").is_err());
        assert!(save_pasted_image_impl(&dir, PNG, "image/png", "20261116-073501").is_err());
        assert!(!dir.join("assets").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn menu_accelerator_update_accepts_known_items() {
        assert!(validate_menu_accelerator("search.file-search", Some("CmdOrCtrl+P")).is_ok());
        assert!(validate_menu_accelerator("view.zoom-out", Some("CmdOrCtrl+-")).is_ok());
        assert!(validate_menu_accelerator("file.save", None).is_ok());
    }

    #[test]
    fn menu_accelerator_update_rejects_unknown_items_and_odd_strings() {
        assert!(validate_menu_accelerator("app.quit", Some("CmdOrCtrl+Q")).is_err());
        assert!(validate_menu_accelerator("file.save", Some("CmdOrCtrl+S; rm")).is_err());
        assert!(validate_menu_accelerator("file.save", Some(&"A".repeat(100))).is_err());
    }

    #[test]
    fn default_app_target_accepts_listed_extension() {
        let dir = scratch_dir("default_app_ok");
        let file = dir.join("x.PDF");
        fs::write(&file, b"%PDF").unwrap();
        let got = default_app_target(&file).unwrap();
        assert_eq!(got, fs::canonicalize(&file).unwrap());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn default_app_target_rejects_unlisted_extension() {
        let dir = scratch_dir("default_app_ext");
        for name in ["x.sh", "x.command", "x.app"] {
            let file = dir.join(name);
            fs::write(&file, b"echo hi").unwrap();
            assert!(default_app_target(&file).is_err(), "{name} must be refused");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn default_app_target_rejects_missing_file() {
        let dir = scratch_dir("default_app_missing");
        assert!(default_app_target(&dir.join("nope.pdf")).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn default_app_target_rejects_directory() {
        let dir = scratch_dir("default_app_dir");
        let sub = dir.join("dir.pdf");
        fs::create_dir_all(&sub).unwrap();
        assert!(default_app_target(&sub).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    const PNG_SIG: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    fn png_b64(extra: &[u8]) -> String {
        let mut bytes = PNG_SIG.to_vec();
        bytes.extend_from_slice(extra);
        general_purpose::STANDARD.encode(bytes)
    }

    fn diagram(name: &str, data_base64: String) -> DiagramImage {
        DiagramImage { name: name.to_string(), data_base64 }
    }

    const GOOD0: &str = "kaelio-diagram-0123456789abcdef-0.png";
    const GOOD1: &str = "kaelio-diagram-0123456789abcdef-1.png";

    #[test]
    fn write_diagrams_writes_valid_png_and_returns_its_path() {
        let dir = scratch_dir("diagrams_ok");
        let written = write_diagrams(&dir, &[diagram(GOOD0, png_b64(b"body"))]).unwrap();
        assert_eq!(written.len(), 1);
        assert_eq!(written[0].0, GOOD0);
        assert_eq!(written[0].1, dir.join(GOOD0));
        assert!(fs::read(&written[0].1).unwrap().starts_with(&PNG_SIG));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_diagrams_rejects_name_with_path_separator() {
        let dir = scratch_dir("diagrams_sep");
        let inner = dir.join("inner");
        fs::create_dir_all(&inner).unwrap();
        let bad = format!("../{GOOD0}");
        assert_eq!(
            write_diagrams(&inner, &[diagram(&bad, png_b64(b"x"))]).unwrap_err(),
            "Invalid diagram data"
        );
        assert!(!dir.join(GOOD0).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_diagrams_rejects_name_not_matching_pattern() {
        let dir = scratch_dir("diagrams_pattern");
        for bad in [
            "x.png",
            "kaelio-diagram-XYZ-0.png",
            "kaelio-diagram-0123456789abcdef-0.jpg",
            "kaelio-diagram-0123456789ABCDEF-0.png",
            "kaelio-diagram-0123456789abcdef-12345.png",
            "kaelio-diagram-0123456789abcdef-.png",
        ] {
            assert!(write_diagrams(&dir, &[diagram(bad, png_b64(b"x"))]).is_err(), "{bad}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_diagrams_rejects_non_png_bytes() {
        let dir = scratch_dir("diagrams_notpng");
        let jpeg = general_purpose::STANDARD.encode([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0]);
        assert!(write_diagrams(&dir, &[diagram(GOOD0, jpeg)]).is_err());
        assert!(write_diagrams(&dir, &[diagram(GOOD0, "not base64!".to_string())]).is_err());
        assert!(!dir.join(GOOD0).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_diagrams_rejects_oversize() {
        let dir = scratch_dir("diagrams_big");
        let big = png_b64(&vec![0u8; 10 * 1024 * 1024]);
        assert!(write_diagrams(&dir, &[diagram(GOOD0, big)]).is_err());
        assert!(!dir.join(GOOD0).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_diagrams_rejects_too_many() {
        let dir = scratch_dir("diagrams_many");
        let many: Vec<DiagramImage> = (0..201)
            .map(|i| diagram(&format!("kaelio-diagram-0123456789abcdef-{i}.png"), png_b64(b"x")))
            .collect();
        assert!(write_diagrams(&dir, &many).is_err());
        assert!(fs::read_dir(&dir).unwrap().next().is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_diagrams_removes_earlier_files_when_a_later_one_fails() {
        let dir = scratch_dir("diagrams_rollback");
        let res = write_diagrams(
            &dir,
            &[diagram(GOOD0, png_b64(b"ok")), diagram(GOOD1, "AAAA".to_string())],
        );
        assert!(res.is_err());
        assert!(!dir.join(GOOD0).exists());
        assert!(!dir.join(GOOD1).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn link_diagrams_replaces_only_listed_names() {
        let md = format!("![diagram]({GOOD0}) and ![x](other.png)");
        let abs = PathBuf::from("/tmp/kaelio_export_1/").join(GOOD0);
        let out = link_diagrams(&md, &[(GOOD0.to_string(), abs.clone())]);
        assert_eq!(out, format!("![diagram]({}) and ![x](other.png)", abs.to_string_lossy()));
    }

    /// Runs the real Pandoc + Typst when both are installed (skips otherwise): a Markdown
    /// image given by absolute path, as `link_diagrams` writes it, must end up in the PDF.
    #[test]
    fn pandoc_pdf_args_embed_an_absolute_path_image() {
        let (Some(pandoc), Some(typst)) = (find_pandoc(), find_typst()) else {
            eprintln!("pandoc or typst not installed; skipping");
            return;
        };
        let dir = scratch_dir("pandoc_pdf_image");
        let png = dir.join(GOOD0);
        // 1x1 white PNG
        fs::write(&png, general_purpose::STANDARD.decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
        ).unwrap()).unwrap();
        let input = dir.join("export.md");
        fs::write(&input, format!("# T\n\n![diagram]({})\n", png.to_string_lossy())).unwrap();
        let header = dir.join("kaelio-tables.typ");
        fs::write(&header, TYPST_TABLE_HEADER).unwrap();
        let output = dir.join("out.pdf");
        let out = Command::new(&pandoc)
            .args(pandoc_pdf_args(&input, &output.to_string_lossy(), &typst, &header))
            .current_dir(&dir)
            .env("TMPDIR", &dir)
            .output()
            .unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        let _ = fs::remove_dir_all(&dir);
        assert!(out.status.success(), "pandoc failed: {stderr}");
    }

    /// A raw Typst block in an untrusted note must not reach Typst as code:
    /// with Typst rooted at `/`, `#read(...)` could copy any local file into the PDF.
    #[test]
    fn pandoc_pdf_args_do_not_pass_raw_typst_through() {
        let Some(pandoc) = find_pandoc() else {
            eprintln!("pandoc not installed; skipping");
            return;
        };
        let dir = scratch_dir("pandoc_raw_typst");
        let input = dir.join("export.md");
        fs::write(&input, "# T\n\n```{=typst}\n#raw(read(\"/etc/hosts\"))\n```\n\nInline `#read(\"/etc/hosts\")`{=typst} too.\n").unwrap();
        let args = pandoc_pdf_args(&input, "unused.pdf", Path::new("typst"), Path::new("h.typ"));
        let from = args.iter().position(|a| a == "--from").map(|i| args[i + 1].clone()).unwrap();
        let out = Command::new(&pandoc)
            .args([input.to_string_lossy().as_ref(), "--from", &from, "-t", "typst"])
            .output()
            .unwrap();
        let _ = fs::remove_dir_all(&dir);
        let typst = String::from_utf8_lossy(&out.stdout).to_string();
        assert!(out.status.success());
        assert!(
            !typst.lines().any(|l| l.trim_start().starts_with("#raw(read(")) && !typst.contains(" #read(\"/etc/hosts\")"),
            "raw Typst reached the output:\n{typst}"
        );
    }

    // --- kaelio-html scheme (opt-in scripts in HTML view) ---

    struct HtmlFixture {
        base: std::path::PathBuf,
        root: std::path::PathBuf,
    }

    impl Drop for HtmlFixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.base);
        }
    }

    /// root/page.html, root/sub/a.css, sibling secret/key.txt, root/link -> secret
    fn html_fixture() -> HtmlFixture {
        // Tests run in parallel and the clock can repeat: add a counter
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let base = super::unique_export_dir(&format!("kaelio_html_test_{}", n));
        let root = base.join("root");
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::create_dir_all(base.join("secret")).unwrap();
        std::fs::write(root.join("page.html"), "<p>hi</p>").unwrap();
        std::fs::write(root.join("sub/a.css"), "p{}").unwrap();
        std::fs::write(base.join("secret/key.txt"), "secret").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(base.join("secret"), root.join("link")).unwrap();
        let root = std::fs::canonicalize(&root).unwrap();
        HtmlFixture { base, root }
    }

    fn html_grants_for(root: &std::path::Path) -> Vec<(String, std::path::PathBuf)> {
        vec![("tok".to_string(), root.to_path_buf())]
    }

    #[test]
    fn html_request_serves_file_in_granted_folder() {
        let f = html_fixture();
        let g = html_grants_for(&f.root);
        assert_eq!(super::resolve_html_request(&g, "/tok/page.html"), Ok(f.root.join("page.html")));
        assert_eq!(super::resolve_html_request(&g, "/tok/sub/a.css"), Ok(f.root.join("sub/a.css")));
        assert_eq!(super::resolve_html_request(&g, "/tok/page%2Ehtml"), Ok(f.root.join("page.html")));
    }

    #[test]
    fn html_request_hidden_segment_is_403() {
        let f = html_fixture();
        std::fs::write(f.root.join(".env"), "KEY=1").unwrap();
        std::fs::create_dir_all(f.root.join(".git")).unwrap();
        std::fs::write(f.root.join(".git/config"), "[core]").unwrap();
        std::fs::create_dir_all(f.root.join("sub/.hidden")).unwrap();
        std::fs::write(f.root.join("sub/.hidden/a.js"), "1").unwrap();
        let g = html_grants_for(&f.root);
        assert_eq!(super::resolve_html_request(&g, "/tok/.env"), Err(403));
        assert_eq!(super::resolve_html_request(&g, "/tok/.git/config"), Err(403));
        assert_eq!(super::resolve_html_request(&g, "/tok/sub/.hidden/a.js"), Err(403));
        assert_eq!(super::resolve_html_request(&g, "/tok/%2eenv"), Err(403));
        assert_eq!(super::resolve_html_request(&g, "/tok/sub%2F.hidden%2Fa.js"), Err(403));
        assert_eq!(super::resolve_html_request(&g, "/tok/sub/a.css"), Ok(f.root.join("sub/a.css")));
    }

    #[cfg(unix)]
    #[test]
    fn html_request_symlink_into_hidden_folder_is_403() {
        let f = html_fixture();
        std::fs::create_dir_all(f.root.join(".private")).unwrap();
        std::fs::write(f.root.join(".private/notes.txt"), "x").unwrap();
        std::os::unix::fs::symlink(f.root.join(".private"), f.root.join("visible")).unwrap();
        let g = html_grants_for(&f.root);
        assert_eq!(super::resolve_html_request(&g, "/tok/visible/notes.txt"), Err(403));
    }

    #[test]
    fn html_request_unknown_token_is_404() {
        let f = html_fixture();
        let g = html_grants_for(&f.root);
        assert_eq!(super::resolve_html_request(&g, "/nope/page.html"), Err(404));
    }

    #[test]
    fn html_request_parent_traversal_is_403() {
        let f = html_fixture();
        let g = html_grants_for(&f.root);
        assert_eq!(super::resolve_html_request(&g, "/tok/../secret/key.txt"), Err(403));
    }

    #[test]
    fn html_request_encoded_traversal_is_403() {
        let f = html_fixture();
        let g = html_grants_for(&f.root);
        assert_eq!(super::resolve_html_request(&g, "/tok/%2e%2e/secret/key.txt"), Err(403));
        assert_eq!(super::resolve_html_request(&g, "/tok/%2E%2E%2Fsecret%2Fkey.txt"), Err(403));
    }

    #[cfg(unix)]
    #[test]
    fn html_request_symlink_out_of_folder_is_403() {
        let f = html_fixture();
        let g = html_grants_for(&f.root);
        assert_eq!(super::resolve_html_request(&g, "/tok/link/key.txt"), Err(403));
    }

    #[test]
    fn html_request_missing_file_is_404() {
        let f = html_fixture();
        let g = html_grants_for(&f.root);
        assert_eq!(super::resolve_html_request(&g, "/tok/none.html"), Err(404));
    }

    #[test]
    fn html_request_directory_is_404() {
        let f = html_fixture();
        let g = html_grants_for(&f.root);
        assert_eq!(super::resolve_html_request(&g, "/tok/sub"), Err(404));
    }

    #[test]
    fn html_request_empty_rest_is_403() {
        let f = html_fixture();
        let g = html_grants_for(&f.root);
        assert_eq!(super::resolve_html_request(&g, "/tok"), Err(403));
        assert_eq!(super::resolve_html_request(&g, "/tok/"), Err(403));
    }

    #[test]
    fn html_request_absolute_or_nul_is_403() {
        let f = html_fixture();
        let g = html_grants_for(&f.root);
        assert_eq!(super::resolve_html_request(&g, "/tok//etc/passwd"), Err(403));
        assert_eq!(super::resolve_html_request(&g, "/tok/%2Fetc%2Fpasswd"), Err(403));
        assert_eq!(super::resolve_html_request(&g, "/tok/page.html%00.png"), Err(403));
    }

    #[test]
    fn html_grant_rejects_non_html_and_missing_files() {
        let f = html_fixture();
        std::fs::write(f.root.join("x.md"), "# x").unwrap();
        let mut grants = Vec::new();
        assert!(super::grant_html(&mut grants, &f.root.join("x.md")).is_err());
        assert!(super::grant_html(&mut grants, &f.root.join("missing.html")).is_err());
        assert!(super::grant_html(&mut grants, &f.root.join("sub")).is_err());
        assert!(grants.is_empty());
        let g = super::grant_html(&mut grants, &f.root.join("page.html")).unwrap();
        assert_eq!(g.file_name, "page.html");
        assert_eq!(g.token.len(), 32);
        assert!(g.token.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)));
        assert_eq!(grants, vec![(g.token.clone(), f.root.clone())]);
    }

    #[test]
    fn html_grant_refuses_home_and_root_folders() {
        let f = html_fixture();
        let mut grants = Vec::new();
        // A page directly in the home folder would expose all of it
        assert!(super::grant_html_in(&mut grants, &f.root.join("page.html"), Some(&f.root)).is_err());
        assert!(grants.is_empty());
        // A page in a subfolder of home is fine
        assert!(super::grant_html_in(&mut grants, &f.root.join("page.html"), Some(&f.base)).is_ok());
    }

    #[test]
    fn html_grants_are_kept_until_revoked() {
        // No cap: an evicted token left its open frame blank (KL-0037).
        // Grants are revoked when the tab closes or scripts are turned off.
        let f = html_fixture();
        let mut grants = Vec::new();
        let first = super::grant_html(&mut grants, &f.root.join("page.html")).unwrap();
        for _ in 0..40 {
            super::grant_html(&mut grants, &f.root.join("page.html")).unwrap();
        }
        assert_eq!(grants.len(), 41);
        assert_eq!(
            super::resolve_html_request(&grants, &format!("/{}/page.html", first.token)),
            Ok(f.root.join("page.html"))
        );
    }

    #[test]
    fn html_revoke_removes_only_that_token() {
        let f = html_fixture();
        let mut grants = Vec::new();
        let a = super::grant_html(&mut grants, &f.root.join("page.html")).unwrap();
        let b = super::grant_html(&mut grants, &f.root.join("page.html")).unwrap();
        super::revoke_html(&mut grants, &a.token);
        assert_eq!(grants.len(), 1);
        assert_eq!(grants[0].0, b.token);
    }

    #[test]
    fn html_content_type_known_and_fallback() {
        use std::path::Path;
        assert_eq!(super::html_content_type(Path::new("a.HTML")), "text/html; charset=utf-8");
        assert_eq!(super::html_content_type(Path::new("a.htm")), "text/html; charset=utf-8");
        assert_eq!(super::html_content_type(Path::new("a.css")), "text/css");
        assert_eq!(super::html_content_type(Path::new("a.mjs")), "text/javascript");
        assert_eq!(super::html_content_type(Path::new("a.json")), "application/json");
        assert_eq!(super::html_content_type(Path::new("a.svg")), "image/svg+xml");
        assert_eq!(super::html_content_type(Path::new("a.woff2")), "font/woff2");
        assert_eq!(super::html_content_type(Path::new("a.exe")), "application/octet-stream");
        assert_eq!(super::html_content_type(Path::new("noext")), "application/octet-stream");
    }
}
