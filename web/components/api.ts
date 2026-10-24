// A small typed fetch helper. Throws Error(message) with the server's `error` text when a call fails.

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function errorFrom(res: Response): Promise<ApiError> {
  let message = `${res.status} ${res.statusText || "Request failed"}`;
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      if (j && typeof j.error === "string") message = j.error;
      else if (j && typeof j.message === "string") message = j.message;
    } catch {
      if (text && text.length < 300) message = text;
    }
  } catch {}
  if (res.status === 401) message = "You are signed out. Reload the page to sign in again.";
  return new ApiError(message, res.status);
}

export async function api<T>(path: string, init?: Omit<RequestInit, "body"> & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const headers = new Headers(rest.headers);
  let body: BodyInit | undefined;
  if (json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(json);
  }
  let res: Response;
  try {
    res = await fetch(path, { ...rest, headers, body });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("Network error. Check your connection and try again.", 0);
  }
  if (!res.ok) throw await errorFrom(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const get = <T,>(path: string) => api<T>(path);
export const post = <T,>(path: string, json?: unknown) => api<T>(path, { method: "POST", json: json ?? {} });
export const patch = <T,>(path: string, json: unknown) => api<T>(path, { method: "PATCH", json });
export const put = <T,>(path: string, json: unknown) => api<T>(path, { method: "PUT", json });
export const del = <T = void,>(path: string) => api<T>(path, { method: "DELETE" });

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
