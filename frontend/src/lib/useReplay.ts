import { useCallback, useEffect, useState } from "react";

/** Playback speeds. 1x shows one candle per second; 0.5x one every two seconds; 2x two per second. */
export const REPLAY_SPEEDS = [0.5, 1, 1.5, 2] as const;
const BASE_INTERVAL_MS = 1000;

export interface ReplayState {
  active: boolean;
  /** Index of the newest revealed bar. */
  cursor: number;
  playing: boolean;
  speed: number;
  atEnd: boolean;
  start: (index: number) => void;
  exit: () => void;
  togglePlay: () => void;
  /** Move by `delta` bars (negative = back) and pause, like scrubbing a video. */
  step: (delta: number) => void;
  setSpeed: (speed: number) => void;
}

/** Bar-replay state for `length` loaded bars. Playback pauses by itself at the last bar. */
export function useReplay(length: number): ReplayState {
  const [active, setActive] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const last = Math.max(0, length - 1);

  useEffect(() => {
    if (!active || !playing) return;
    const id = setInterval(() => setCursor((c) => Math.min(c + 1, last)), BASE_INTERVAL_MS / speed);
    return () => clearInterval(id);
  }, [active, playing, speed, last]);

  useEffect(() => {
    if (playing && cursor >= last) setPlaying(false);
  }, [playing, cursor, last]);

  const start = useCallback((index: number) => {
    setCursor(Math.max(0, Math.min(index, last)));
    setPlaying(false);
    setActive(true);
  }, [last]);
  const exit = useCallback(() => { setActive(false); setPlaying(false); }, []);
  const togglePlay = useCallback(() => setPlaying((p) => !p), []);
  const step = useCallback((delta: number) => {
    setPlaying(false);
    setCursor((c) => Math.max(0, Math.min(c + delta, last)));
  }, [last]);

  return { active, cursor: Math.min(cursor, last), playing, speed, atEnd: cursor >= last, start, exit, togglePlay, step, setSpeed };
}
