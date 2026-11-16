/** Cache of local preview images as data URLs, keyed by absolute path.
 *
 *  Bounded by the total length of the stored data-URL text; the oldest entry
 *  goes first. Entries are dropped when a watcher reports a change to their
 *  path (or to a folder above it), and `generation` lets a caller discard a
 *  read that started before such a change, so a stale image is not stored. */
export const LOCAL_IMAGE_CACHE_MAX_BYTES = 64 * 1024 * 1024;

export class LocalImageCache {
  private entries = new Map<string, string>();
  private bytes = 0;
  private gen = 0;

  private readonly maxBytes: number;

  constructor(maxBytes = LOCAL_IMAGE_CACHE_MAX_BYTES) {
    this.maxBytes = maxBytes;
  }

  /** Read this before starting a load and pass it to `set`. */
  get generation(): number { return this.gen; }
  get size(): number { return this.entries.size; }
  get totalSize(): number { return this.bytes; }

  get(path: string): string | undefined {
    return this.entries.get(path);
  }

  /** Stores `url` unless the cache changed since `generation` was read or the
   *  entry alone exceeds the budget. */
  set(path: string, url: string, generation: number): void {
    if (generation !== this.gen) return;
    if (url.length > this.maxBytes) return;
    this.remove(path);
    while (this.bytes + url.length > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
    this.entries.set(path, url);
    this.bytes += url.length;
  }

  /** Drops each path and everything below it. Returns true when an entry was dropped. */
  invalidate(paths: readonly string[]): boolean {
    const targets = paths.filter(p => p.length > 0);
    if (targets.length === 0) return false;
    this.gen++;
    let dropped = false;
    for (const key of Array.from(this.entries.keys())) {
      if (targets.some(t => key === t || key.startsWith(t.endsWith("/") ? t : t + "/"))) {
        this.remove(key);
        dropped = true;
      }
    }
    return dropped;
  }

  clear(): void {
    this.gen++;
    this.entries.clear();
    this.bytes = 0;
  }

  private remove(path: string): void {
    const old = this.entries.get(path);
    if (old === undefined) return;
    this.bytes -= old.length;
    this.entries.delete(path);
  }
}
