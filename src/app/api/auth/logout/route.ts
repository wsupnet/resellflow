import { destroySession } from "@/lib/auth";
import { isCrossSite } from "@/lib/origin";

export async function POST(req: Request) {
  // Another site can't sign you out by auto-submitting a form at this URL.
  if (isCrossSite(req)) return new Response("forbidden", { status: 403 });
  await destroySession();
  // Relative Location: req.url is the container's internal address (0.0.0.0:3000),
  // not the host/port/proxy the browser actually used.
  return new Response(null, { status: 303, headers: { Location: "/login" } });
}
