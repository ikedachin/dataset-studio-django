declare global { interface Window { __CSRF_TOKEN__?: string } }

export class ApiError extends Error { constructor(message: string, public status: number, public details?: unknown) { super(message) } }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (init.method && init.method !== 'GET') headers.set('X-CSRFToken', window.__CSRF_TOKEN__ ?? '')
  const response = await fetch(`/api${path}`, { ...init, headers })
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message: string; details?: unknown } }
  if (!response.ok) throw new ApiError(payload.error?.message ?? response.statusText, response.status, payload.error?.details)
  return payload.data as T
}

export const jsonBody = (value: unknown): Pick<RequestInit, 'body'> => ({ body: JSON.stringify(value) })
