import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { api } from "../api";
import { TrashIcon } from "./icons";

/**
 * Two-step delete button for a podcast. First click arms the confirm state
 * ("click again to confirm"), second click issues DELETE /api/podcasts/:id
 * and navigates back to the library. Deletion is permanent: episodes,
 * transcripts, and cached audio are removed.
 */
export default function DeletePodcastButton({
  podcastId,
  podcastTitle,
}: {
  podcastId: string;
  podcastTitle: string;
}) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await api.api.podcasts[":id"].$delete({ param: { id: podcastId } });
      const data = await res.json().catch(() => null);
      if (!res.ok || (data && "error" in data)) {
        throw new Error(
          data && "error" in data ? data.error : `Delete failed (${res.status})`,
        );
      }
      await navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConfirming(false);
    } finally {
      setDeleting(false);
    }
  }

  function handleBlur() {
    // Disarm the confirm state when focus leaves without confirming, so a
    // stray armed button doesn't linger.
    if (!deleting) setConfirming(false);
  }

  return (
    <div className="flex flex-col items-end gap-1" onBlur={handleBlur}>
      <button
        type="button"
        onClick={handleClick}
        disabled={deleting}
        aria-label={
          confirming ? `Confirm deletion of ${podcastTitle}` : `Delete ${podcastTitle}`
        }
        title={confirming ? "Click again to confirm" : "Delete this podcast"}
        className={`btn btn-sm min-h-11 ${confirming ? "btn-error" : "btn-ghost text-error/70 hover:text-error"}`}
      >
        {deleting ? (
          <span className="loading loading-spinner loading-xs" />
        ) : (
          <TrashIcon className="h-4 w-4" />
        )}
        {confirming ? "Confirm delete" : "Delete"}
      </button>
      {confirming && !error && (
        <p className="text-xs text-base-content/60" role="status">
          This removes all episodes and transcripts. Click again to confirm.
        </p>
      )}
      {error && (
        <p className="text-xs text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
