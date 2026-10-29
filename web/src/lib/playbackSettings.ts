export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const STORAGE_KEY = "playbackRate";

export function isPlaybackRate(rate: number): boolean {
  return PLAYBACK_RATES.some((value) => value === rate);
}

export function loadPlaybackRate(): number {
  try {
    const rate = Number(localStorage.getItem(STORAGE_KEY));
    if (isPlaybackRate(rate)) return rate;
  } catch {
    // Storage can be unavailable in private browsing.
  }
  return 1;
}

export function savePlaybackRate(rate: number): void {
  if (!isPlaybackRate(rate)) return;
  try {
    localStorage.setItem(STORAGE_KEY, String(rate));
  } catch {
    // The selected speed still applies for this session.
  }
}
