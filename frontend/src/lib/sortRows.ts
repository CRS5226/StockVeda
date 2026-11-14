export type SortDir = "asc" | "desc";
export interface SortState<K extends string> { key: K; dir: SortDir }

/**
 * Rows ordered by one field. Empty values (null) always go last, whichever way it is sorted; text is compared
 * without regard to case. Returns a new array and leaves the input alone.
 */
export function sortRows<T, K extends keyof T>(rows: T[], key: K, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key] as unknown, y = b[key] as unknown;
    if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
    if (y === null || y === undefined) return -1;
    if (typeof x === "string" && typeof y === "string") return sign * x.localeCompare(y, undefined, { sensitivity: "base" });
    return sign * ((x as number) - (y as number));
  });
}

/** What a click on a column header does: first click ascending, second descending, third clears the sort. */
export function nextSort<K extends string>(current: SortState<K> | null, key: K): SortState<K> | null {
  if (!current || current.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : null;
}
