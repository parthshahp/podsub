// Shared in-memory transcription job registry (resets on server restart).
// Extracted so both episode-detail and episode-list routes report the same
// queue state — the episode list icon needs the live queued/running status,
// not just the persisted hasTranscript flag.

export type JobStatus = "queued" | "running" | "done" | "failed";
export type TranscribeStatus = "idle" | "queued" | "running" | "failed";

type Job = { status: JobStatus; error?: string };

const jobs = new Map<string, Job>();

export function getJob(episodeId: string): Job | undefined {
  return jobs.get(episodeId);
}

export function setJob(episodeId: string, job: Job): void {
  jobs.set(episodeId, job);
}

/** Public status for API responses: finished jobs read as idle. */
export function getTranscribeStatus(episodeId: string): TranscribeStatus {
  const job = jobs.get(episodeId);
  if (!job || job.status === "done") return "idle";
  return job.status;
}

export function getTranscribeError(episodeId: string): string | null {
  return jobs.get(episodeId)?.error ?? null;
}
