import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export type AudioChunk = { file: string; offset: number };

// MP3's Xing header describes how many samples a decoder skips at the start.
// The first segment has encoder + decoder delay; later segments have decoder
// delay only. Map the decoded samples ASR sees back onto the source timeline.
async function skippedSeconds(file: string): Promise<number> {
  const { stdout } = await execFileP("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-read_intervals",
    "%+#1",
    "-show_packets",
    "-show_streams",
    "-of",
    "json",
    file,
  ]);
  const data = JSON.parse(stdout);
  const rate = Number(data.streams?.[0]?.sample_rate);
  const skip =
    data.packets?.[0]?.side_data_list?.find(
      (item: { side_data_type: string }) => item.side_data_type === "Skip Samples",
    )?.skip_samples ?? 0;
  if (!(rate > 0)) throw new Error(`Missing audio sample rate: ${file}`);
  return skip / rate;
}

/** Single-pass MP3 encoding, with offsets taken from the actual segment timeline. */
export async function chunkAudio(
  file: string,
  dir: string,
  seconds: number,
): Promise<AudioChunk[]> {
  if (!(seconds > 0) || !Number.isFinite(seconds)) throw new Error("Invalid audio chunk duration");
  const list = path.join(dir, "segments.csv");
  await execFileP("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    file,
    // Exclude cover art: otherwise it is copied into every request.
    "-vn",
    "-map",
    "0:a:0",
    "-f",
    "segment",
    "-segment_time",
    String(seconds),
    "-segment_list",
    list,
    "-segment_list_type",
    "csv",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "64k",
    path.join(dir, "chunk%03d.mp3"),
  ]);
  const chunks: AudioChunk[] = [];
  let initialSkip = 0;
  const lines = (await readFile(list, "utf8")).trim().split("\n");
  for (const [index, line] of lines.entries()) {
    // Generated basenames have no commas or CSV quoting characters.
    const match = /^(chunk\d+\.mp3),([\d.]+),([\d.]+)$/.exec(line);
    if (!match) throw new Error(`Invalid audio segment entry: ${line}`);
    const chunk = path.join(dir, match[1]!);
    const start = Number(match[2]);
    const end = Number(match[3]);
    if (end - start < 1) {
      // A short ending may be real speech. Only skip fragments with no decodable
      // samples (a segmenter flush can produce a header / single-frame MP3).
      let decoded;
      try {
        decoded = await execFileP(
          "ffmpeg",
          [
            "-v",
            "error",
            "-i",
            chunk,
            "-t",
            "1",
            "-ac",
            "1",
            "-ar",
            "8000",
            "-f",
            "s16le",
            "pipe:1",
          ],
          { encoding: "buffer", maxBuffer: 64 * 1024, timeout: 30_000 },
        );
      } catch (error) {
        const failure = error as { code?: number; stderr?: Buffer };
        if (
          index !== lines.length - 1 ||
          typeof failure.code !== "number" ||
          !/Invalid data|Failed to find two consecutive|Invalid frame/i.test(String(failure.stderr))
        ) {
          throw error;
        }
        console.warn(`Skipping undecodable trailing audio fragment: ${chunk}`);
        continue;
      }
      if (decoded.stdout.length === 0) {
        if (index !== lines.length - 1) throw new Error(`Empty interior audio chunk: ${chunk}`);
        continue;
      }
    }
    const skip = await skippedSeconds(chunk);
    if (chunks.length === 0) initialSkip = skip;
    chunks.push({ file: chunk, offset: start + skip - initialSkip });
  }
  if (chunks.length === 0) throw new Error("Audio contains no decodable chunks");
  return chunks;
}
