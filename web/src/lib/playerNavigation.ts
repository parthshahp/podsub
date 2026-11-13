/** Ignore malformed deep links rather than sending NaN/Infinity to <audio>. */
export function parsePlayerSearch(search: Record<string, unknown>): { t?: number } {
  const raw = search.t;
  if (typeof raw !== "number" && typeof raw !== "string") return {};
  if (typeof raw === "string" && raw.trim() === "") return {};
  const t = Number(raw);
  return Number.isFinite(t) && t >= 0 && t <= 86400 ? { t } : {};
}
