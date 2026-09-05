/** Apple-style fuzzy duration: "19 secs" under a minute, else "26 mins". */
export function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} secs`;
  return `${Math.round(sec / 60)} mins`;
}

/** Clock time for the player bar: 12:34 or 1:02:03. */
export function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** List-style date: "September 3". */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric" });
}
