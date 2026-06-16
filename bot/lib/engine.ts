/**
 * Sage adaptive engine — ported from webapp/index.html prototype.
 * Pure logic, no I/O. The 2-up/2-down staircase, per-topic mastery EMA,
 * floor rule, and widening question search. Parameterized by `settings`
 * loaded from the Butterbase settings table (config-not-constants).
 */

export interface Question {
  id: string; // Butterbase uuid
  qid: string; // AQuA id, e.g. aqua_test_0001
  question: string;
  choices: { label: string; text: string }[];
  correct: string;
  rationale: string | null;
  topic: string;
  difficulty: number;
  hints: string[] | null;
  distractor_diagnoses: Record<string, string> | null;
}

export interface MasteryRow {
  topic: string;
  level: number;
  attempts: number;
  correct: number;
}

export interface EngineSettings {
  sessionLen: number; // SESSION_LEN
  staircaseUp: number; // consecutive correct → +1
  staircaseDown: number; // consecutive incorrect → −1
  defaultEntryLevel: number;
  masteryAlpha: number; // EMA rate
  softTimeS: number;
}

export interface SprintState {
  difficulty: number;
  streak: number;
  missStreak: number;
  lastTopic: string | null;
  askedQids: string[];
  history: { qid: string; topic: string; difficulty: number; correct: boolean; secs: number | null }[];
}

export const newSprintState = (entryDifficulty: number): SprintState => ({
  difficulty: entryDifficulty,
  streak: 0,
  missStreak: 0,
  lastTopic: null,
  askedQids: [],
  history: [],
});

const acc = (m: MasteryRow) => (m.attempts ? m.correct / m.attempts : null);

export function pickTopic(state: SprintState, pool: Question[], mastery: Map<string, MasteryRow>): string {
  let topics = [...new Set(pool.map((q) => q.topic))];
  if (topics.length > 1) topics = topics.filter((t) => t !== state.lastTopic);
  const unseen = topics.filter((t) => !mastery.has(t));
  if (unseen.length && Math.random() < 0.5) return unseen[Math.floor(Math.random() * unseen.length)];
  const scored = topics.map((t) => ({ t, a: mastery.has(t) ? acc(mastery.get(t)!) ?? 0.5 : 0.5 }));
  scored.sort((x, y) => x.a - y.a);
  const k = Math.min(scored.length, 3); // among 3 weakest
  return scored[Math.floor(Math.random() * k)].t;
}

/** Widening search: topic+diff → topic ±1 → topic any → any@diff → anything. */
export function pickQuestion(state: SprintState, pool: Question[], mastery: Map<string, MasteryRow>): Question | null {
  const candidates = pool.filter((q) => !state.askedQids.includes(q.qid));
  if (!candidates.length) return null;
  const topic = pickTopic(state, candidates, mastery);
  const want = state.difficulty;
  // The announced sprint difficulty must match the question served. Honor the
  // EXACT level (preferring the chosen topic) before loosening difficulty, so
  // "stepping up to 3/5" never serves a 2/5 and "easing to 1/5" never serves a
  // 4/5. Topic is still preferred whenever the exact level exists in it.
  const tries: ((q: Question) => boolean)[] = [
    (q) => q.topic === topic && q.difficulty === want,
    (q) => q.difficulty === want,
    (q) => q.topic === topic && Math.abs(q.difficulty - want) <= 1,
    (q) => Math.abs(q.difficulty - want) <= 1,
    (q) => q.topic === topic,
    () => true,
  ];
  for (const f of tries) {
    const c = candidates.filter(f);
    if (c.length) {
      const q = c[Math.floor(Math.random() * c.length)];
      state.askedQids.push(q.qid);
      state.lastTopic = q.topic;
      return q;
    }
  }
  return null;
}

export interface AnswerResult {
  correct: boolean;
  adaptNote: string | null;
  floorRuleFired: boolean; // concept gap → teaching mode + XTrace fact
  masteryUpdate: MasteryRow;
}

export function recordAnswer(
  state: SprintState,
  q: Question,
  pickedLabel: string,
  secs: number | null,
  mastery: Map<string, MasteryRow>,
  s: EngineSettings,
  opts: { hintsUsed?: number; usedWalkthrough?: boolean } = {},
): AnswerResult {
  const correct = pickedLabel === q.correct;
  const m = mastery.get(q.topic) ?? { topic: q.topic, attempts: 0, correct: 0, level: s.defaultEntryLevel };
  m.attempts++;
  if (correct) m.correct++;
  m.level = m.level + s.masteryAlpha * ((correct ? q.difficulty + 0.5 : q.difficulty - 1) - m.level);
  mastery.set(q.topic, m);

  // Scoring honesty: hint/walkthrough answers never advance the staircase.
  const unaided = correct && !opts.hintsUsed && !opts.usedWalkthrough;

  let adaptNote: string | null = null;
  let floorRuleFired = false;
  if (correct) {
    state.missStreak = 0;
    if (unaided) {
      state.streak++;
      if (state.streak >= s.staircaseUp && state.difficulty < 5) {
        state.difficulty++;
        state.streak = 0;
        adaptNote = `Two in a row — stepping up to ${state.difficulty}/5.`;
      }
    } else {
      state.streak = 0; // partial credit: counts for mastery, not the staircase
    }
  } else {
    state.streak = 0;
    state.missStreak++;
    if (state.missStreak >= s.staircaseDown) {
      if (state.difficulty > 1) {
        state.difficulty--;
        adaptNote = `Two misses in a row — easing to ${state.difficulty}/5. The next one is more approachable.`;
      } else {
        floorRuleFired = true; // concept gap, not difficulty
        adaptNote = `This looks like a concept gap in ${q.topic.replace(/-/g, " ")}, not a difficulty problem.`;
      }
      state.missStreak = 0;
    }
  }
  state.history.push({ qid: q.qid, topic: q.topic, difficulty: q.difficulty, correct, secs });
  return { correct, adaptNote, floorRuleFired, masteryUpdate: m };
}

export function entryDifficulty(mastery: Map<string, MasteryRow>, s: EngineSettings): number {
  if (!mastery.size) return s.defaultEntryLevel;
  const levels = [...mastery.values()].map((m) => m.level);
  const avg = levels.reduce((a, b) => a + b, 0) / levels.length;
  return Math.max(1, Math.min(5, Math.round(avg)));
}

export interface SprintSummary {
  nCorrect: number;
  total: number;
  avgSecs: number | null;
  peakDifficulty: number;
  strengths: string[];
  gaps: string[];
  resumeDifficulty: number;
  byTopic: Record<string, { c: number; n: number }>;
}

export function summarize(state: SprintState): SprintSummary {
  const h = state.history;
  const byTopic: Record<string, { c: number; n: number }> = {};
  for (const x of h) {
    const t = (byTopic[x.topic] ||= { c: 0, n: 0 });
    t.n++;
    if (x.correct) t.c++;
  }
  const timed = h.filter((x) => x.secs != null);
  return {
    nCorrect: h.filter((x) => x.correct).length,
    total: h.length,
    avgSecs: timed.length ? Math.round(timed.reduce((a, x) => a + (x.secs ?? 0), 0) / timed.length) : null,
    peakDifficulty: h.length ? Math.max(...h.map((x) => x.difficulty)) : 0,
    strengths: Object.entries(byTopic).filter(([, v]) => v.c === v.n && v.n > 0).map(([t]) => t),
    gaps: Object.entries(byTopic).filter(([, v]) => v.c < v.n).map(([t]) => t),
    resumeDifficulty: state.difficulty,
    byTopic,
  };
}
