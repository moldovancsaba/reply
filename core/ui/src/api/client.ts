// The one place that talks to the Reply Core service. Every call has a timeout and returns a Result, never throws:
// screens render the error through GDS state components instead of crashing.
export type ApiError = { code: string; message: string; requestId: string; retryable: boolean; status: number; details?: Record<string, unknown> };
export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };
export type FetchOptions = { signal?: AbortSignal; timeoutMs?: number; method?: "GET" | "POST"; body?: unknown };

const DEFAULT_TIMEOUT_MS = 10_000;

const failure = (error: Partial<ApiError> & { code: string; message: string }): Result<never> => ({
  ok: false,
  error: { requestId: "", retryable: false, status: 0, ...error },
});

export async function fetchJson<T>(path: string, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, method = "GET", body }: FetchOptions = {}): Promise<Result<T>> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      signal: combined,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (signal?.aborted) return failure({ code: "aborted", message: "The request was cancelled." });
    if (timeout.aborted) return failure({ code: "timeout", message: "Reply Core took too long to answer.", retryable: true });
    void err;
    return failure({ code: "network_error", message: "Reply Core could not be reached.", retryable: true });
  }
  if (res.status === 304) return failure({ code: "not_modified", message: "Not modified.", status: 304 });
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return failure({ code: "invalid_response", message: "Reply Core sent something unexpected.", status: res.status, retryable: res.status >= 500 });
  }
  if (!res.ok) {
    const e = (json as { error?: Partial<ApiError> })?.error;
    if (e && typeof e.code === "string") {
      return { ok: false, error: { code: e.code, message: String(e.message ?? ""), requestId: String(e.requestId ?? ""), retryable: Boolean(e.retryable), status: res.status, ...(e.details ? { details: e.details } : {}) } };
    }
    return failure({ code: "invalid_response", message: "Reply Core sent something unexpected.", status: res.status, retryable: res.status >= 500 });
  }
  return { ok: true, data: json as T };
}
