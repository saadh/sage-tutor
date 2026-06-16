/**
 * Butterbase data-API client for Sage.
 * Platform findings (see docs/PRODUCT_BRIEF.md §findings):
 *  - row ops by id require UUID PKs (all tables use uuid id; AQuA id = qid)
 *  - jsonb columns must be JSON-encoded STRINGS on write
 *  - settings table (not `config` — reserved route); filter with ?name=eq.X
 */
import type { Question, MasteryRow, EngineSettings, SprintState } from "./engine.ts";

const BASE = process.env.BUTTERBASE_URL!;
const KEY = process.env.BUTTERBASE_API_KEY!;

async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`butterbase ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : (undefined as T);
}

// ---------- settings (config-not-constants, 60s TTL cache) ----------
type Settings = EngineSettings & { nudgeDelayS: number; demoMode: boolean; model: string; microSessionLen: number };
let settingsCache: { at: number; value: Settings } | null = null;
export async function loadSettings(): Promise<Settings> {
  if (settingsCache && Date.now() - settingsCache.at < 60_000) return settingsCache.value;
  const rows = await api<{ name: string; value: string }[]>("GET", "/settings?select=name,value&limit=100");
  const g = (n: string, d: string) => rows.find((r) => r.name === n)?.value ?? d;
  const value: Settings = {
    sessionLen: +g("SESSION_LEN", "10"),
    microSessionLen: +g("MICRO_SESSION_LEN", "3"),
    staircaseUp: +g("STAIRCASE_UP", "2"),
    staircaseDown: +g("STAIRCASE_DOWN", "2"),
    defaultEntryLevel: +g("DEFAULT_ENTRY_LEVEL", "2"),
    masteryAlpha: +g("MASTERY_ALPHA", "0.3"),
    softTimeS: +g("SOFT_TIME_S", "120"),
    nudgeDelayS: +g("NUDGE_DELAY_S", "120"),
    demoMode: g("DEMO_MODE", "false") === "true",
    model: g("MODEL", "anthropic/claude-haiku-4.5"),
  };
  settingsCache = { at: Date.now(), value };
  return value;
}

// ---------- questions ----------
let questionCache: Question[] | null = null;
export async function loadServableQuestions(): Promise<Question[]> {
  if (questionCache) return questionCache;
  const rows = await api<any[]>(
    "GET",
    "/questions?select=id,qid,question,choices,correct,rationale,topic,difficulty,hints,distractor_diagnoses&verified=is.true&needs_review=is.false&limit=1000",
  );
  questionCache = rows.map((r) => ({
    ...r,
    choices: typeof r.choices === "string" ? JSON.parse(r.choices) : r.choices,
    hints: typeof r.hints === "string" ? JSON.parse(r.hints) : r.hints,
    distractor_diagnoses:
      typeof r.distractor_diagnoses === "string" ? JSON.parse(r.distractor_diagnoses) : r.distractor_diagnoses,
  }));
  return questionCache!;
}

// ---------- users ----------
export interface UserRow { id: string; phone: string; name: string | null; role: string }
export async function getOrCreateUser(phone: string, name?: string): Promise<UserRow> {
  const found = await api<UserRow[]>("GET", `/users?phone=eq.${encodeURIComponent(phone)}&limit=1`);
  if (found.length) return found[0];
  return api<UserRow>("POST", "/users", { phone, name: name ?? null, verified_at: new Date().toISOString() });
}

// ---------- sessions ----------
export interface SessionRow {
  id: string; user_id: string; mode: string; state: string;
  current_question_id: string | null; question_index: number;
  score: number | null; web_token: string | null;
}
export async function createSession(user_id: string, mode: string, web_token: string): Promise<SessionRow> {
  return api<SessionRow>("POST", "/sessions", { user_id, mode, state: "in_question", web_token });
}
export async function updateSession(id: string, patch: Partial<SessionRow> & { ended_at?: string; state?: string }) {
  return api("PATCH", `/sessions/${id}`, patch);
}
export async function getSession(id: string): Promise<SessionRow | null> {
  try { return await api<SessionRow>("GET", `/sessions/${id}`); } catch { return null; }
}
export async function getSessionByToken(token: string): Promise<SessionRow | null> {
  const rows = await api<SessionRow[]>("GET", `/sessions?web_token=eq.${encodeURIComponent(token)}&limit=1`);
  return rows[0] ?? null;
}
/** Recent sessions (any state), newest first — for the "last time…" greeting. */
export async function listRecentSessions(user_id: string, limit = 12): Promise<SessionRow[]> {
  return api<SessionRow[]>("GET", `/sessions?user_id=eq.${user_id}&order=started_at.desc&limit=${limit}&select=id,state,started_at`);
}
/** Most recent unfinished sprint for a user (crash/restart resume). */
export async function getOpenSession(user_id: string): Promise<(SessionRow & { sprint_state?: any }) | null> {
  const rows = await api<(SessionRow & { sprint_state?: any })[]>(
    "GET",
    `/sessions?user_id=eq.${user_id}&state=eq.in_question&order=started_at.desc&limit=1`,
  );
  return rows[0] ?? null;
}

// ---------- attempts ----------
export async function insertAttempt(a: {
  session_id: string; question_id: string; qid: string; answer: string; correct: boolean;
  hint_count?: number; used_walkthrough?: boolean; latency_s?: number | null; surface?: string;
}) {
  return api("POST", "/attempts", a);
}
export async function listAttempts(session_id: string) {
  return api<any[]>("GET", `/attempts?session_id=eq.${session_id}&order=ts.asc&limit=100`);
}
/** Every qid this user has already answered (across all their sessions) —
 *  used to avoid re-serving previously completed questions. */
export async function loadAnsweredQids(user_id: string): Promise<Set<string>> {
  const sessions = await api<{ id: string }[]>("GET", `/sessions?user_id=eq.${user_id}&select=id&limit=300`);
  const qids = new Set<string>();
  for (let i = 0; i < sessions.length; i += 50) {
    const chunk = sessions.slice(i, i + 50).map((s) => s.id).join(",");
    if (!chunk) continue;
    const rows = await api<{ qid: string }[]>("GET", `/attempts?session_id=in.(${chunk})&select=qid&limit=2000`);
    for (const r of rows) if (r.qid) qids.add(r.qid);
  }
  return qids;
}

// ---------- mastery ----------
export async function loadMastery(user_id: string): Promise<Map<string, MasteryRow & { id?: string }>> {
  const rows = await api<any[]>("GET", `/mastery?user_id=eq.${user_id}&limit=100`);
  return new Map(rows.map((r) => [r.topic, r]));
}
export async function saveMastery(user_id: string, m: MasteryRow & { id?: string }) {
  if (m.id) return api("PATCH", `/mastery/${m.id}`, { level: m.level, attempts: m.attempts, correct: m.correct, updated_at: new Date().toISOString() });
  return api("POST", "/mastery", { user_id, topic: m.topic, level: m.level, attempts: m.attempts, correct: m.correct });
}

// ---------- nudges ----------
export async function insertNudge(n: { user_id: string; trigger_type: string; body: string; sent_at: string }) {
  return api("POST", "/nudges", n);
}

// ---------- AI gateway ----------
export async function chat(messages: { role: string; content: string }[], opts: { model?: string; max_tokens?: number; temperature?: number } = {}): Promise<string> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ messages, stream: false, max_tokens: opts.max_tokens ?? 500, temperature: opts.temperature ?? 0.4, ...(opts.model ? { model: opts.model } : {}) }),
  });
  if (!res.ok) throw new Error(`gateway → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}
