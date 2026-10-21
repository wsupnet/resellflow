import "server-only";
import { cookies } from "next/headers";

const FLASH = "flash";

/**
 * Set a one-shot success/info message from a server action. It's read by the app
 * layout on the next render and shown as a toast, then cleared. A nonce prefix
 * makes repeated identical messages distinct so the client always re-fires.
 */
export function setFlash(message: string) {
  // Not httpOnly: the Toaster clears it client-side (document.cookie) so dismissing
  // a toast doesn't require a server round-trip / re-render.
  cookies().set(FLASH, `${Date.now()}:${message}`, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 15
  });
}

export function readFlash(): string | undefined {
  return cookies().get(FLASH)?.value;
}
