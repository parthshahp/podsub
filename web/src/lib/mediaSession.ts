/**
 * Connect system / headset controls to the same audio element as the UI.
 * Each action is optional: browsers can support Media Session but reject
 * individual actions. Native audio events remain the source of truth.
 */
export function bindMediaSession(audio: HTMLAudioElement, seek: (time: number) => void) {
  if (!("mediaSession" in navigator)) return () => {};
  const session = navigator.mediaSession;
  const registered: MediaSessionAction[] = [];

  const seekTo = (time: number) => {
    if (!Number.isFinite(time) || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    seek(Math.min(Math.max(time, 0), audio.duration));
    sync();
  };
  const offset = (details: MediaSessionActionDetails) => {
    const value = details.seekOffset;
    return value != null && Number.isFinite(value) && value > 0 ? value : 10;
  };

  const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
    [
      "play",
      () => {
        void audio.play().catch(() => {});
      },
    ],
    ["pause", () => audio.pause()],
    ["seekbackward", (details) => seekTo(audio.currentTime - offset(details))],
    ["seekforward", (details) => seekTo(audio.currentTime + offset(details))],
    [
      "seekto",
      (details) => {
        if (details.seekTime != null) seekTo(details.seekTime);
      },
    ],
  ];
  for (const [action, handler] of actions) {
    try {
      session.setActionHandler(action, handler);
      registered.push(action);
    } catch {
      // Unsupported action: leave other system controls working.
    }
  }

  function sync() {
    session.playbackState = audio.ended ? "none" : audio.paused ? "paused" : "playing";
    if (typeof session.setPositionState !== "function") return;
    try {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
        session.setPositionState();
        return;
      }
      session.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate > 0 ? audio.playbackRate : 1,
        position: Math.min(Math.max(audio.currentTime, 0), audio.duration),
      });
    } catch {
      // A changing source can temporarily have no usable position.
    }
  }

  const events = [
    "play",
    "pause",
    "ended",
    "loadedmetadata",
    "durationchange",
    "timeupdate",
    "ratechange",
    "seeked",
    "emptied",
  ];
  for (const event of events) audio.addEventListener(event, sync);
  sync();

  return () => {
    for (const event of events) audio.removeEventListener(event, sync);
    for (const action of registered) session.setActionHandler(action, null);
    session.playbackState = "none";
    if (typeof session.setPositionState === "function") session.setPositionState();
  };
}
