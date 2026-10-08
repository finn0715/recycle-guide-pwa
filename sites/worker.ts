import { callApi } from "./call-api";
import assets from "virtual:assets";
type Env = { OPENAI_API_KEY?: string };
type Context = { waitUntil: (work: Promise<unknown>) => void };
const noStore = { "Cache-Control": "no-store" };
const decode = (text: string) => Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
const worker = {
  async fetch(request: Request, env: Env, ctx: Context) {
    const url = new URL(request.url);
    if (url.pathname === "/api/call") return callApi(request, env, ctx);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const asset = assets[pathname];
    if (!asset) return new Response("Not found", { status: 404, headers: noStore });
    const headers = new Headers({ "Content-Type": asset.type, "X-Content-Type-Options": "nosniff", "Permissions-Policy": "camera=(self), microphone=(self)", "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" });
    if (pathname === "/sw.js") headers.set("Service-Worker-Allowed", "/");
    return new Response(request.method === "HEAD" ? null : decode(asset.bytes), { headers });
  },
};

export default worker;
