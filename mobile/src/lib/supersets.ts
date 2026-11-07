/**
 * Superset rules shared by the routine editor and the live workout. Adjacent items with the
 * same `supersetGroup` form a superset; groups are numbered 1, 2, … in order.
 */
export interface Groupable {
  supersetGroup: number | null;
}

/**
 * Renumber superset groups 1, 2, … in order. A group that reappears after a different
 * exercise starts a new group, and one-exercise groups are dropped. Same numbering as the
 * server's `normalize_supersets`, but it repairs instead of rejecting.
 */
export function repairSupersets(groups: (number | null)[]): (number | null)[] {
  const runs: { group: number | null; start: number; end: number }[] = [];
  groups.forEach((group, index) => {
    const last = runs[runs.length - 1];
    if (last && group !== null && last.group === group) last.end = index + 1;
    else runs.push({ group, start: index, end: index + 1 });
  });
  const result: (number | null)[] = groups.map(() => null);
  let next = 1;
  for (const run of runs) {
    if (run.group === null || run.end - run.start < 2) continue;
    for (let i = run.start; i < run.end; i += 1) result[i] = next;
    next += 1;
  }
  return result;
}

export function withRepairedSupersets<T extends Groupable>(items: T[]): T[] {
  const groups = repairSupersets(items.map((item) => item.supersetGroup));
  return items.map((item, i) =>
    item.supersetGroup === groups[i] ? item : { ...item, supersetGroup: groups[i] ?? null },
  );
}

export function isLinkedWithNext(items: readonly Groupable[], index: number): boolean {
  const current = items[index];
  const next = items[index + 1];
  return Boolean(
    current &&
    next &&
    current.supersetGroup !== null &&
    current.supersetGroup === next.supersetGroup,
  );
}

/** Link an item with the one below it into a superset, or split them apart. */
export function toggleLinkWithNext<T extends Groupable>(items: T[], index: number): T[] {
  const current = items[index];
  const next = items[index + 1];
  if (!current || !next) return items;

  const fresh = Math.max(0, ...items.map((item) => item.supersetGroup ?? 0)) + 1;
  const result = [...items];
  if (isLinkedWithNext(items, index)) {
    // Split: everything after this boundary in the same run becomes its own group.
    for (let i = index + 1; i < result.length; i += 1) {
      const item = result[i] as T;
      if (item.supersetGroup !== current.supersetGroup) break;
      result[i] = { ...item, supersetGroup: fresh };
    }
  } else {
    const group = current.supersetGroup ?? next.supersetGroup ?? fresh;
    result[index] = { ...current, supersetGroup: group };
    // The whole run below joins, so linking into an existing superset keeps it together.
    const below = next.supersetGroup;
    for (let i = index + 1; i < result.length; i += 1) {
      const item = result[i] as T;
      if (i > index + 1 && (below === null || item.supersetGroup !== below)) break;
      result[i] = { ...item, supersetGroup: group };
    }
  }
  return withRepairedSupersets(result);
}

/**
 * Move an item one place. Inside its own superset it swaps with its neighbour. Otherwise it
 * leaves its superset and jumps over the neighbouring superset as a whole, so moving never
 * breaks another superset apart. Returns `items` itself when already at that end.
 */
export function moveKeepingSupersets<T extends Groupable>(
  items: T[],
  index: number,
  delta: -1 | 1,
): T[] {
  const current = items[index];
  const neighbour = items[index + delta];
  if (!current || !neighbour) return items;

  const result = [...items];
  if (current.supersetGroup !== null && current.supersetGroup === neighbour.supersetGroup) {
    result[index] = neighbour;
    result[index + delta] = current;
    return result;
  }

  // The neighbouring block: one item, or its whole superset.
  let far = index + delta;
  if (neighbour.supersetGroup !== null) {
    while (result[far + delta]?.supersetGroup === neighbour.supersetGroup) far += delta;
  }
  // Removing it shifts a block below up by one, so `far` is the slot past the block either way.
  result.splice(index, 1);
  result.splice(far, 0, { ...current, supersetGroup: null });
  return withRepairedSupersets(result);
}
