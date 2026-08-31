// Single-user access gate (issue #19646 item 6: "Ariel + the agent itself" — no multi-user
// auth system). Every /api/* and dashboard request must carry the shared secret either as
// header `X-CFO-Secret` or query param `?key=` (the latter so the static dashboard's own
// <script> fetch calls and a plain browser bookmark both work without a JS-side secret store).

export function isAuthorized(request: Request, sharedSecret: string): boolean {
  if (!sharedSecret) return false;
  const header = request.headers.get("X-CFO-Secret");
  if (header && timingSafeEqual(header, sharedSecret)) return true;
  const url = new URL(request.url);
  const queryKey = url.searchParams.get("key");
  if (queryKey && timingSafeEqual(queryKey, sharedSecret)) return true;
  return false;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
