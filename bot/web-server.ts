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

export interface WebHooks {
  /** Send an outbound iMessage (Photon) — used by the signup flow. */
  sendTo?: (phone: string, text: string) => Promise<void>;
  geminiKey?: string;
}

export function startWebServer(port = 8420, hooks: WebHooks = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      const json = (code: number, body: unknown) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };

      // ---- API: signup (landing page) → create user + Sage texts FIRST ----
      if (url.pathname === "/api/signup" && req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const { name, phone, exam_date } = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        if (!phone) return json(400, { ok: false, error: "phone required" });
        const norm = String(phone).replace(/[^0-9+]/g, "");
        // create-or-get user
        const found = await fetch(`${BASE}/users?phone=eq.${encodeURIComponent(norm)}&limit=1`, {
          headers: { Authorization: `Bearer ${KEY}` } }).then((r) => r.json());
        if (!found.length) {
          await fetch(`${BASE}/users`, { method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
            body: JSON.stringify({ phone: norm, name: name || null, exam_date: exam_date || null }) });
        }
        if (!hooks.sendTo) return json(503, { ok: false, error: "iMessage not active" });
        await hooks.sendTo(norm, `Hi${name ? " " + name : ""}, Sage here 🎓 Reply GO to verify this number and start your first calibration sprint.`);
        return json(200, { ok: true, phone: norm });
      }

      // ---- API: voice config (local demo only — key stays on localhost) ----
      if (url.pathname === "/api/voice-config" && req.method === "GET") {
        return json(200, { key: hooks.geminiKey ?? null });
      }

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
