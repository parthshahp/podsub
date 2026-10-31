import { useRef } from "react";
import type { ExportStatus } from "../../hooks/useAnkiExport";
import { useSurfacePresence } from "../../hooks/useSurfacePresence";

/** Preserve the last message only long enough for a non-interactive exit. */
export function PlaybackStatus({ status }: { status: ExportStatus | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(status);
  if (status) previous.current = status;
  const present = useSurfacePresence(status !== null, ref);
  const message = status ?? previous.current;
  if (!present || !message) return null;
  return (
    <div
      ref={ref}
      role={status ? "status" : undefined}
      aria-hidden={!status}
      inert={!status}
      data-motion-kind="status"
      data-motion-input={message.pointerTriggered ? "pointer" : "keyboard"}
      className={`motion-surface alert absolute right-4 bottom-16 z-10 w-auto max-w-md py-2 text-sm shadow-lg sm:right-6 sm:bottom-6 ${message.kind === "success" ? "alert-success" : "alert-error"}`}
    >
      {message.message}
    </div>
  );
}
