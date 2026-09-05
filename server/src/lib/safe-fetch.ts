import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF-safe fetch: follows redirects manually and re-validates every hop
 * (protocol allow-list, then DNS resolution checked against non-routable
 * ranges). Known limitation: DNS rebinding between validation and connect.
 */

const MAX_REDIRECTS = 5;
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Non-routable IPv4 ranges. */
const IPV4_BLOCKED: Array<[number, number]> = (
  [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ] as Array<[string, number]>
).map(([base, prefix]) => [ipv4ToInt(base)!, prefix]);

/** Non-routable IPv6 ranges. */
const IPV6_BLOCKED: Array<[bigint, number]> = [
  "::/128",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
  "ff00::/8",
].map((cidr): [bigint, number] => {
  const slash = cidr.indexOf("/");
  const base = cidr.slice(0, slash);
  const prefix = Number(cidr.slice(slash + 1));
  return [ipv6ToBigInt(base)!, prefix];
});

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8) | n;
  }
  return value >>> 0;
}

/** Expand an IPv6 address to a 128-bit BigInt. */
function ipv6ToBigInt(ip: string): bigint | null {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);

  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];

  // Embedded IPv4 (e.g. ::ffff:192.168.1.1) → two hex groups.
  for (const side of [head, tail]) {
    const last = side.at(-1);
    if (last?.includes(".")) {
      const v4 = ipv4ToInt(last);
      if (v4 === null) return null;
      side.splice(-1, 1, ((v4 >>> 16) & 0xffff).toString(16), (v4 & 0xffff).toString(16));
    }
  }

  const missing = 8 - (head.length + tail.length);
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const padding = Array.from({ length: missing }, () => "0");
  const groups = [...head, ...padding, ...tail];

  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

export function isPrivateIp(address: string): boolean {
  switch (isIP(address)) {
    case 4: {
      const value = ipv4ToInt(address);
      return (
        value === null ||
        IPV4_BLOCKED.some(([base, prefix]) => value >>> (32 - prefix) === base >>> (32 - prefix))
      );
    }
    case 6: {
      // IPv4-mapped — judge by the embedded v4 address.
      const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
      if (mapped) return isPrivateIp(mapped[1]);
      const value = ipv6ToBigInt(address);
      if (value === null) return true; // unparseable -> fail closed
      return IPV6_BLOCKED.some(
        ([base, prefix]) => value >> BigInt(128 - prefix) === base >> BigInt(128 - prefix),
      );
    }
    default:
      return true; // unknown family -> fail closed
  }
}

/**
 * Assert `url` is http(s) and every resolved address is publicly routable.
 * Must be re-run per redirect hop (safeFetch does).
 */
export async function assertPublicHttpUrl(url: string): Promise<void> {
  const parsed = new URL(url); // throws on unparseable input
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Blocked non-http(s) protocol: ${parsed.protocol}`);
  }
  const addresses = await lookup(parsed.hostname, { all: true });
  if (addresses.length === 0) {
    throw new Error(`Could not resolve host: ${parsed.hostname}`);
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new Error(`Blocked non-public address ${address} for host ${parsed.hostname}`);
    }
  }
}

/**
 * fetch() with per-hop SSRF validation, capped redirects, and a per-hop
 * header timeout. Body is NOT size-limited — use cappedBodyStream/readBodyCapped.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  opts: { timeoutMs?: number; maxRedirects?: number } = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxRedirects = MAX_REDIRECTS } = opts;
  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHttpUrl(current);
    const res = await fetch(current, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).href;
      continue;
    }
    return res;
  }
  throw new Error(`Too many redirects (limit ${maxRedirects})`);
}

/** Reject up front if the declared size already exceeds the cap. */
function assertDeclaredSize(res: Response, maxBytes: number): void {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Response content-length ${declared} exceeds limit of ${maxBytes} bytes`);
  }
}

/**
 * Wrap a response body so reading it errors once `maxBytes` is exceeded.
 */
export function cappedBodyStream(res: Response, maxBytes: number): ReadableStream<Uint8Array> {
  if (!res.body) throw new Error("Response has no body");
  assertDeclaredSize(res, maxBytes);

  const reader = res.body.getReader();
  let total = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        controller.error(new Error(`Response body exceeded limit of ${maxBytes} bytes`));
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** Buffer a response body, failing if it exceeds `maxBytes`. */
export async function readBodyCapped(res: Response, maxBytes: number): Promise<Buffer> {
  assertDeclaredSize(res, maxBytes);
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response body exceeded limit of ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}
