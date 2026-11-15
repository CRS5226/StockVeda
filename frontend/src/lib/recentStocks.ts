/** The stocks a person looked at last, kept in the browser so the Stocks page can offer them again. */

const KEY = "stockveda.recentStocks";
export const MAX_RECENT = 8;
const SYMBOL = /^[A-Z0-9&_-]{1,20}$/;

/** Read the stored list back. Anything that is not a list of plausible symbols is ignored. */
export function parseRecent(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const symbols = value.filter((s): s is string => typeof s === "string" && SYMBOL.test(s));
    return [...new Set(symbols)].slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/** Put `symbol` first, drop an older copy of it, and keep at most `max` symbols. */
export function addRecent(list: string[], symbol: string, max = MAX_RECENT): string[] {
  const sym = symbol.trim().toUpperCase();
  if (!SYMBOL.test(sym)) return list;
  return [sym, ...list.filter((s) => s !== sym)].slice(0, max);
}

// Storage can be missing or blocked (private window, cleared site data), so every access is guarded.
export function loadRecent(): string[] {
  try {
    return parseRecent(window.localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function rememberStock(symbol: string): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(addRecent(loadRecent(), symbol)));
  } catch {
    /* nothing to do: the list is only a convenience */
  }
}
