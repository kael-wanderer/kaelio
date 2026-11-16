/**
 * One-time migration for saved custom shortcuts when default bindings change.
 * A saved custom binding always wins: any default (for an action the user has
 * not customised) whose key is already taken by a custom binding is unbound,
 * so one key never triggers two actions.
 */
export function migrateKeybindings(
  custom: Record<string, string>,
  defaults: { id: string; defaultKey: string }[],
): Record<string, string> {
  const result: Record<string, string> = { ...custom };
  for (const def of defaults) {
    if (Object.prototype.hasOwnProperty.call(custom, def.id)) continue;
    const key = def.defaultKey.toLowerCase();
    const taken = Object.entries(custom).some(
      ([id, k]) => id !== def.id && typeof k === "string" && k !== "" && k.toLowerCase() === key,
    );
    if (taken) result[def.id] = "";
  }
  return result;
}
