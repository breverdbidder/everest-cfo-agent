// Fetch layer -- same shared-secret gate convention as the legacy public/dashboard.js
// (sessionStorage key "cfo_agent_key", header X-CFO-Secret) so a bookmarked session key
// keeps working across this rewrite.

const KEY_STORAGE = "cfo_agent_key";

export function getKey(): string {
  return sessionStorage.getItem(KEY_STORAGE) || "";
}

export function setKey(key: string): void {
  sessionStorage.setItem(KEY_STORAGE, key);
}

export function clearKey(): void {
  sessionStorage.removeItem(KEY_STORAGE);
}

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
  }
}

export async function apiGet<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }
  const resp = await fetch(url.toString(), { headers: { "X-CFO-Secret": getKey() } });
  if (resp.status === 401) {
    clearKey();
    throw new UnauthorizedError();
  }
  if (!resp.ok) throw new Error(`${path} -> HTTP ${resp.status}`);
  return resp.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(path, {
    method: "POST",
    headers: { "X-CFO-Secret": getKey(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (resp.status === 401) {
    clearKey();
    throw new UnauthorizedError();
  }
  if (!resp.ok) throw new Error(`${path} -> HTTP ${resp.status} ${await resp.text().catch(() => "")}`);
  return resp.json();
}

/** Issue #19810 -- invoice ingest supports either a raw file upload (PDF/text) or pasted text,
 * so this posts FormData instead of JSON (no Content-Type header -- the browser sets the
 * multipart boundary itself). */
export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  const resp = await fetch(path, { method: "POST", headers: { "X-CFO-Secret": getKey() }, body: form });
  if (resp.status === 401) {
    clearKey();
    throw new UnauthorizedError();
  }
  if (!resp.ok) throw new Error(`${path} -> HTTP ${resp.status} ${await resp.text().catch(() => "")}`);
  return resp.json();
}
