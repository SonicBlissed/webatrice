import { useEffect, useRef, useState } from "react";

/**
 * Human-readable "how long ago" — e.g. "just now", "43m", "2h 15m".
 * Used for room age display in the lobby and (potentially) other short-lived
 * timestamps. Keep it terse; anything longer than a few hours is unusual for
 * a room.
 */
export function formatElapsed(iso: string, now: number = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "just now";
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

/**
 * Returns the current epoch ms, updated on the given interval. Use to force
 * a re-render for any component displaying `formatElapsed()` output so its
 * label stays fresh.
 */
export function useNow(intervalMs: number = 60_000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Adaptive debounce: a value that only "settles" once the source has been
 * idle for a while.
 *
 * - A change that arrives after `idleMs` of no activity commits quickly
 *   (`freshMs`, ~300ms) — a single edit doesn't feel sluggish.
 * - A change that arrives during a burst of edits resets a longer trailing
 *   debounce (`stableMs`, ~3s) — a "gorilla-click" storm only triggers one
 *   downstream update, once the user has stopped.
 *
 * `pending` reflects "the source has changed but the committed value hasn't
 * caught up yet" — use it to drive a loading state.
 */
export function useAdaptiveDebounce<T>(
  value: T,
  fingerprint: string,
  {
    freshMs = 300,
    stableMs = 3000,
    idleMs = 3000,
  }: { freshMs?: number; stableMs?: number; idleMs?: number } = {},
): { committed: T; pending: boolean } {
  const [committed, setCommitted] = useState<T>(value);
  const [committedFp, setCommittedFp] = useState<string>(fingerprint);
  const lastChange = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (fingerprint === committedFp) {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      return;
    }

    const now = Date.now();
    const idle = now - lastChange.current;
    lastChange.current = now;

    // Idle-followed-by-single-change → quick commit. Rapid consecutive
    // changes → trailing debounce.
    const delay = idle > idleMs ? freshMs : stableMs;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setCommitted(value);
      setCommittedFp(fingerprint);
    }, delay);

    return () => {
      // Note: intentionally NOT clearing timer.current here — we WANT the
      // trailing commit to fire even if `value` keeps changing during the
      // wait. React will call the cleanup before running the effect for the
      // next render, but the actual commit is guarded by timer.current
      // getting reassigned above.
    };
  }, [fingerprint, committedFp, value, freshMs, stableMs, idleMs]);

  return { committed, pending: fingerprint !== committedFp };
}
