type TranscriptEmptyStateProps = {
  transcribeStatus: "idle" | "queued" | "running" | "failed";
  transcribeError: string | null;
  postError: string | null;
  starting: boolean;
  onDownload: () => void;
};

/** Shown while no transcript exists: transcription progress or the download button. */
export function TranscriptEmptyState({
  transcribeStatus,
  transcribeError,
  postError,
  starting,
  onDownload,
}: TranscriptEmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      {transcribeStatus === "running" || transcribeStatus === "queued" ? (
        <>
          <span className="loading loading-spinner loading-sm" />
          <p className="text-sm text-base-content/60">Transcribing this episode…</p>
          <p className="text-xs text-base-content/40">
            This can take a few minutes — the transcript will appear here automatically.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-base-content/60">No transcript available for this episode.</p>
          <button className="btn btn-primary" onClick={onDownload} disabled={starting}>
            {starting && <span className="loading loading-spinner loading-sm" />}
            {starting ? "Starting…" : "Download transcript now"}
          </button>
          {(postError ?? transcribeError) && (
            <p className="text-sm text-error">{postError ?? transcribeError}</p>
          )}
        </>
      )}
    </div>
  );
}
