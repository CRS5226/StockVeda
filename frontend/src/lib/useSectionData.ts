import { useEffect, useState } from "react";
import { isNotFound } from "./connections";

export interface SectionState<T> {
  data: T | null;
  loading: boolean;
  /** The server said there is no data for this stock yet (HTTP 404). */
  missing: boolean;
  /** A real failure, as text. */
  error: string;
}

/** Load one section of the Connections page. Reloads when `deps` change and ignores a late answer for an old stock. */
export function useSectionData<T>(load: () => Promise<T>, deps: unknown[]): SectionState<T> {
  const [state, setState] = useState<SectionState<T>>({ data: null, loading: true, missing: false, error: "" });

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, loading: true, missing: false, error: "" });
    load()
      .then((data) => { if (!cancelled) setState({ data, loading: false, missing: false, error: "" }); })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState(isNotFound(e)
          ? { data: null, loading: false, missing: true, error: "" }
          : { data: null, loading: false, missing: false, error: "Could not load this section." });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
