/**
 * API utility — centralised HTTP client for the Aerospace platform.
 *
 * Every backend call should go through this module so that base URL,
 * headers, and error handling are managed in one place.
 * Swap `NEXT_PUBLIC_API_URL` via .env.local for staging / production.
 */

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Generic typed fetch wrapper.
 * Throws on non-2xx responses so callers can handle errors uniformly.
 */
async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

// ── Health ─────────────────────────────────────────────────────

export interface HealthResponse {
  status: string;
}

/** Check backend connectivity. */
export async function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}
