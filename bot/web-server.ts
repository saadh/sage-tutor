/**
 * Sage web server — serves web/ (tutor room, dashboard) and proxies
 * /api/tutor-chat to the deployed Butterbase function with the service
 * key held server-side (functions require auth; browsers hold no keys).
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
const BASE = process.env.BUTTERBASE_URL!;
const KEY = process.env.BUTTERBASE_API_KEY!;

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
};

export function startWebServer(port = 8420) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);

      // ---- API: tutor chat (proxied to the Butterbase function) ----
      if (url.pathname === "/api/tutor-chat" && req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        // /fn/* requires end-user JWTs; service keys use the admin invoke route
        const fnRes = await fetch(`${BASE}/functions/tutor-chat/invoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
          body: Buffer.concat(chunks),
        });
        const body = await fnRes.text();
        res.writeHead(fnRes.status, { "Content-Type": "application/json" });
        return res.end(body);
      }

      // ---- static files from web/ ----
      let file = url.pathname === "/" ? "/index.html" : url.pathname;
      const full = path.join(WEB_DIR, path.normalize(file).replace(/^(\.\.[\/\\])+/, ""));
      if (!full.startsWith(WEB_DIR)) {
        res.writeHead(403);
        return res.end("forbidden");
      }
      const data = await readFile(full);
      res.writeHead(200, { "Content-Type": MIME[path.extname(full)] ?? "application/octet-stream" });
      return res.end(data);
    } catch (e: any) {
      if (e?.code === "ENOENT") {
        res.writeHead(404);
        return res.end("not found");
      }
      console.error("web-server error:", e);
      res.writeHead(500);
      return res.end("server error");
    }
  });
  server.listen(port, () => console.log(`✓ Sage web at http://localhost:${port} (tutor room + api)`));
  return server;
}
