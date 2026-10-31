/**
 * True when a browser sent this request from another site. Browsers attach an
 * Origin header to every cross-site POST, so a mismatch with our own host means a
 * page elsewhere is submitting it (login CSRF and the like). Mirrors the check
 * Next.js applies to server actions, including the forwarded host set by a
 * reverse proxy (Caddy / Tailscale). No Origin header (curl, old clients) passes.
 */
export function isCrossSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
  try {
    return new URL(origin).host !== host;
  } catch {
    return true; // "null" or garbage origin
  }
}

/** JSON endpoints only accept JSON — a cross-site form/text post can't fake it without CORS. */
export function isJson(req: Request): boolean {
  return (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() === "application/json";
}
