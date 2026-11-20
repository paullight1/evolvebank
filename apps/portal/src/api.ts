export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(path: string, options: { method?: string; body?: unknown; key?: string } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.key ? { 'Idempotency-Key': options.key } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'We could not reach the sandbox. Check your connection and try again.');
  }
  const text = await response.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : undefined; } catch {
    throw new ApiError(response.status || 502, 'INVALID_RESPONSE', 'The sandbox returned an unreadable response. Please retry the original request.');
  }
  if (!response.ok) {
    const error = data as { error?: { code?: string; message?: string }; message?: string } | undefined;
    throw new ApiError(response.status, error?.error?.code ?? 'REQUEST_FAILED', error?.error?.message ?? error?.message ?? 'The request could not be completed.');
  }
  return data as T;
}
