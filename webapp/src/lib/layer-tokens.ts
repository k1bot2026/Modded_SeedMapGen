/**
 * Structure-layer token codec for the URL hash.
 *
 * Tokens are either full structure ids (`minecraft:village_plains`) or
 * `<namespace>:*` when every known structure of that namespace is enabled.
 */

export function namespaceOf(id: string): string {
  const idx = id.indexOf(":");
  return idx === -1 ? "" : id.slice(0, idx);
}

export function groupByNamespace(
  ids: readonly string[],
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const ns = namespaceOf(id);
    const list = groups.get(ns);
    if (list) list.push(id);
    else groups.set(ns, [id]);
  }
  return groups;
}

/** Enabled set -> compact token list (stable order: sorted). */
export function compactLayerTokens(
  enabled: ReadonlySet<string>,
  allIds: readonly string[],
): string[] {
  const groups = groupByNamespace(allIds);
  const tokens: string[] = [];
  for (const ns of [...groups.keys()].sort()) {
    const ids = groups.get(ns) ?? [];
    const enabledIds = ids.filter((id) => enabled.has(id));
    if (enabledIds.length === 0) continue;
    if (enabledIds.length === ids.length) {
      tokens.push(`${ns}:*`);
    } else {
      tokens.push(...enabledIds.sort());
    }
  }
  return tokens;
}

/** Token list -> enabled set (unknown ids are dropped). */
export function expandLayerTokens(
  tokens: readonly string[],
  allIds: readonly string[],
): Set<string> {
  const known = new Set(allIds);
  const groups = groupByNamespace(allIds);
  const enabled = new Set<string>();
  for (const token of tokens) {
    if (token.endsWith(":*")) {
      const ns = token.slice(0, -2);
      for (const id of groups.get(ns) ?? []) enabled.add(id);
    } else if (known.has(token)) {
      enabled.add(token);
    }
  }
  return enabled;
}
