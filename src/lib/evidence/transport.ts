/**
 * Minimal HTTP transport abstraction so every adapter has one code path for
 *   - live calls (fetchTransport), and
 *   - recorded real responses in tests and fixed-packet trials (recordedTransport).
 * A blocked or failed call is an observable result (status 0 + note), never a silent empty list.
 */

export interface TransportRequest {
  url: string;
  headers?: Record<string, string>;
}

export interface TransportResponse {
  /** HTTP status; 0 means the request never reached the host (blocked, DNS, network). */
  status: number;
  body: string;
  note?: string;
}

export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  status: number;
  text(): Promise<string>;
}>;

/**
 * Live transport. NOT exercised in the Cowork sandbox (outbound calls to bibliographic hosts are
 * blocked there); exercise it from the app host before relying on it.
 */
export function fetchTransport(fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike): Transport {
  return async (req) => {
    try {
      const res = await fetchImpl(req.url, { headers: req.headers });
      return { status: res.status, body: await res.text() };
    } catch (err) {
      return { status: 0, body: "", note: err instanceof Error ? err.message : String(err) };
    }
  };
}

export interface RecordedResponse extends TransportResponse {
  /** When and how the recording was made, so a reviewer can judge it. */
  recordedAt?: string;
  recordedBy?: string;
}

/**
 * Replays recorded responses keyed by exact URL. Unknown URLs are reported (status 0), so a test
 * cannot pass by accident on a request nobody recorded.
 */
export function recordedTransport(fixtures: Record<string, RecordedResponse>): Transport {
  return async (req) => {
    const hit = fixtures[req.url];
    if (!hit) return { status: 0, body: "", note: `no recorded response for ${req.url}` };
    return { status: hit.status, body: hit.body, note: hit.note };
  };
}

/** A channel known to be unavailable (policy block, no network). Useful for failure-path tests. */
export function blockedTransport(reason: string): Transport {
  return async () => ({ status: 0, body: "", note: reason });
}
