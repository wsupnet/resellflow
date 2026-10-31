/**
 * Read a JSON request body with a hard byte cap, for unauthenticated endpoints.
 * Route handlers have no body-size limit of their own (next.config's bodySizeLimit
 * only covers server actions), so without this a single huge POST is buffered
 * whole in memory before anything can reject it.
 */
export type JsonBody = { ok: true; data: unknown } | { ok: false; status: 400 | 413 };

export async function readJsonLimited(req: Request, maxBytes: number): Promise<JsonBody> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413 };
  if (!req.body) return { ok: false, status: 400 };

  // Also enforce the cap while streaming: Content-Length can be absent (chunked)
  // or wrong.
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, status: 413 };
    }
    chunks.push(value);
  }
  try {
    return { ok: true, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, status: 400 };
  }
}
