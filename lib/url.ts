import "server-only";
import { headers } from "next/headers";

/** Public base URL used in student links / QR codes.
 *  Uses NEXT_PUBLIC_APP_URL when it looks valid, otherwise the host of the current request. */
export async function appBaseUrl(): Promise<string> {
  const env = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  if (/^https?:\/\/[^\s/]+$/.test(env)) return env;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
