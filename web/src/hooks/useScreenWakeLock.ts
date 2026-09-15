import { useEffect } from "react";

/**
 * Holds a screen wake lock while `active` is true.
 *
 * Follows https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API:
 * - requests a `"screen"` sentinel when playback starts,
 * - releases it when playback pauses or the component unmounts,
 * - re-requests it when the document becomes visible again (locks are
 *   automatically released when the document goes hidden/inactive).
 *
 * No-ops on browsers without `navigator.wakeLock`, and silently ignores
 * request failures (low battery, power-save mode, permissions policy) —
 * playback works the same, the screen just sleeps normally.
 */
export function useScreenWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (!("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = async () => {
      try {
        const s = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await s.release();
          return;
        }
        sentinel = s;
      } catch {
        // Request rejected (e.g. NotAllowedError on low battery or an
        // inactive document). Playback continues without the lock.
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" || cancelled) return;
      // The system auto-releases the lock while hidden; grab a fresh one.
      if (sentinel == null || sentinel.released) void request();
    };

    void request();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      // Release is async but fire-and-forget is fine on cleanup.
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
