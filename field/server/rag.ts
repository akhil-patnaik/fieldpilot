import OpenAI from "openai";
import { config } from "./config.ts";
import { KNOWLEDGE_BASE, type KbDoc } from "./seed.ts";

/**
 * Enterprise knowledge retrieval over the seed corpus (manuals, service/safety bulletins, SOPs, policy,
 * past resolutions, field notes).
 *
 *  • Hybrid when embeddings are available through the configured OpenAI-compatible provider:
 *    BM25 + cosine similarity fused with Reciprocal Rank Fusion.
 *  • BM25-only fallback — no extra key needed, and used automatically if the embeddings call fails.
 *  • Context boost: the active asset's model and fault codes (so "this fault" works).
 *  • Prompt-injection hygiene: instruction-like sentences in documents are removed at index time and
 *    flagged; results are returned as delimited DATA for the model, never as instructions.
 */

export interface SearchHit {
  docId: string;
  title: string;
  type: KbDoc["type"];
  trust: KbDoc["trust"];
  section?: string;
  heading: string;
  /** Short spoken citation, e.g. "the RTC-220 service manual, section 4.2". */
  cite: string;
  score: number;
  text: string;
  flagged: string[];
}

interface Chunk {
  id: string;
  doc: KbDoc;
  section?: string;
  heading: string;
  cite: string;
  text: string;
  flagged: string[];
  tokens: string[];
  tf: Map<string, number>;
  vec?: number[];
}

// ───────────────────────── injection hygiene ─────────────────────────

const INJECTION = [
  /\bignore\b.{0,30}\b(previous|prior|above|earlier|all)\b.{0,20}\b(instructions?|rules|prompts?)\b/i,
  /\bdisregard\b.{0,30}\b(instructions?|rules|policy|prompts?)\b/i,
  /(^|\s)(system|assistant|developer)\s*:/i,
  /\byou are now\b|\bnew instructions?\b|\bact as\b/i,
  /\b(approve|confirm|execute|call|run)\b.{0,50}\b(purchase orders?|tools?|confirm_action|every|all)\b.{0,40}\b(without|automatically|no need)\b/i,
];

export function sanitize(text: string) {
  const flagged: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = sentences.map((s) => {
    if (INJECTION.some((re) => re.test(s))) {
      flagged.push(s.trim());
      return "[instruction-like text removed]";
    }
    return s;
  });
  return { text: kept.join(" "), flagged };
}

// ───────────────────────── BM25 ─────────────────────────

const STOP = new Set(
  "a an and are as at be by for from has have if in into is it its of on or the then this to was were will with your you not when any all per can may must only what whats how do does i my me we our".split(" "),
);
const stem = (w: string) => w.replace(/(ing|edly|ed|es|s)$/u, "").replace(/(ation)$/u, "ate");

export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9µ]+(?:[-.][a-z0-9]+)*/gu) ?? [])
    .flatMap((t) => (t.includes("-") ? [t, ...t.split("-")] : [t]))
    .filter((t) => !STOP.has(t) && t.length > 1)
    .map(stem);
}

/** Field vocabulary: what techs say vs what documents print. */
const SYNONYMS: Record<string, string[]> = {
  microfarad: ["µf"], microfarads: ["µf"], uf: ["µf"], mfd: ["µf"],
  spec: ["rated", "specification"], specs: ["rated", "specification"],
  cap: ["capacitor"], lockout: ["loto"], tagout: ["loto"],
  procedure: ["troubleshooting", "step"], fix: ["troubleshooting", "replace"], steps: ["step", "procedure"],
  limit: ["approval"], approve: ["approval"], escalate: ["escalation"],
  pressure: ["psi"], head: ["discharge"], trip: ["fault"], tripping: ["fault"],
  vaccine: ["vaccines", "cold"], fridge: ["cold", "room"], return: ["returns", "core", "rma"], rma: ["return", "core"],
  wrap: ["close", "out"], closeout: ["close", "out"], "close-out": ["close", "out"],
};

const chunks: Chunk[] = KNOWLEDGE_BASE.flatMap((doc) =>
  doc.chunks.map((c, i) => {
    const { text, flagged } = sanitize(c.text);
    const full = `${doc.title} — ${c.section ? `${c.section} ` : ""}${c.heading}\n${text}`;
    const tokens = tokenize(full);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { id: `${doc.id}#${c.section ?? i}`, doc, section: c.section, heading: c.heading, cite: c.section ? `${doc.citeAs}, section ${c.section}` : doc.citeAs, text, flagged, tokens, tf };
  }),
);

const N = chunks.length;
const avgdl = chunks.reduce((a, c) => a + c.tokens.length, 0) / Math.max(N, 1);
const df = new Map<string, number>();
for (const c of chunks) for (const t of new Set(c.tokens)) df.set(t, (df.get(t) ?? 0) + 1);

function bm25(q: string[], c: Chunk) {
  const k1 = 1.4;
  const b = 0.75;
  let s = 0;
  for (const t of q) {
    const f = c.tf.get(t);
    if (!f) continue;
    const n = df.get(t) ?? 0;
    s += Math.log(1 + (N - n + 0.5) / (n + 0.5)) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * c.tokens.length) / avgdl)));
  }
  return s;
}

function boost(c: Chunk, model?: string) {
  let m = c.doc.trust === "unverified" ? 0.6 : 1;
  if (model) {
    const ml = model.toLowerCase();
    if (c.doc.models.some((x) => x.toLowerCase() === ml || ml.includes(x.toLowerCase().split(" ").pop()!) || x.toLowerCase().includes(ml))) m *= 1.6;
    else if (c.doc.models.includes("all")) m *= 1.1;
    else m *= 0.45;
  }
  return m;
}

// ───────────────────────── embeddings (optional) ─────────────────────────

type EmbState = { status: "off" | "loading" | "ready" | "failed"; model: string; error?: string };
let emb: EmbState = { status: "off", model: "" };
let embCfg = { ...config.embeddings };
let embClient: OpenAI | null = null;
let loading: Promise<void> | null = null;
const queryCache = new Map<string, number[]>();

const norm = (v: number[]) => {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
};
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms))]);

/** Override the embedding provider (tests) — resets the vector index. */
export function configureEmbeddings(cfg: Partial<typeof embCfg>) {
  embCfg = { ...embCfg, ...cfg };
  emb = { status: "off", model: embCfg.model };
  embClient = null;
  loading = null;
  queryCache.clear();
  for (const c of chunks) c.vec = undefined;
}

async function ensureEmbeddings() {
  if (!embCfg.model) return;
  if (emb.status === "ready" || emb.status === "failed") return;
  loading ??= (async () => {
    emb = { status: "loading", model: embCfg.model };
    try {
      embClient = new OpenAI({ baseURL: embCfg.baseURL, apiKey: embCfg.apiKey || "not-needed" });
      const res = await withTimeout(embClient.embeddings.create({ model: embCfg.model, input: chunks.map((c) => `${c.doc.title} — ${c.heading}\n${c.text}`) }), 15000);
      res.data.forEach((d, i) => (chunks[d.index ?? i].vec = norm(d.embedding as number[])));
      if (chunks.some((c) => !c.vec)) throw new Error("embedding response incomplete");
      emb = { status: "ready", model: embCfg.model };
      console.log(`[rag] hybrid retrieval ready — ${N} chunks embedded with ${embCfg.model}`);
    } catch (e: any) {
      emb = { status: "failed", model: embCfg.model, error: e?.message ?? String(e) };
      console.warn(`[rag] embeddings unavailable (${emb.error}) — using BM25 only`);
    }
  })();
  await loading;
}

async function embedQuery(q: string) {
  const hit = queryCache.get(q);
  if (hit) return hit;
  const res = await withTimeout(embClient!.embeddings.create({ model: embCfg.model, input: q }), 4000);
  const v = norm(res.data[0].embedding as number[]);
  queryCache.set(q, v);
  return v;
}

// ───────────────────────── search ─────────────────────────

export interface SearchOpts {
  /** Equipment model to boost, e.g. "Arctis RTC-220". */
  model?: string;
  /** Active fault codes from context, e.g. ["HP-02"] — appended when the query names none. */
  faultCodes?: string[];
  k?: number;
}

export async function searchKb(query: string, opts: SearchOpts = {}): Promise<{ mode: "hybrid" | "bm25"; expandedQuery: string; hits: SearchHit[] }> {
  const k = opts.k ?? 4;
  const namesFault = /\b[a-z]{2,4}-\d{1,2}[a-z]?\b/i.test(query);
  const expandedQuery = !namesFault && opts.faultCodes?.length ? `${query} ${opts.faultCodes.join(" ")}` : query;
  const words = expandedQuery.toLowerCase().split(/\s+/);
  const q = [...new Set([...tokenize(expandedQuery), ...words.flatMap((w) => SYNONYMS[w.replace(/[^a-z-]/g, "")] ?? []).flatMap(tokenize)])];

  const lexical = chunks.map((c) => ({ c, s: bm25(q, c) * boost(c, opts.model) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);

  await ensureEmbeddings().catch(() => {});
  let mode: "hybrid" | "bm25" = "bm25";
  let ranked: { c: Chunk; s: number }[] = lexical;
  if (emb.status === "ready") {
    try {
      const qv = await embedQuery(expandedQuery);
      const semantic = chunks.map((c) => ({ c, s: dot(qv, c.vec!) * boost(c, opts.model) })).sort((a, b) => b.s - a.s);
      const rrf = new Map<Chunk, number>();
      const add = (list: { c: Chunk }[]) => list.forEach((x, i) => rrf.set(x.c, (rrf.get(x.c) ?? 0) + 1 / (60 + i + 1)));
      add(lexical);
      add(semantic.slice(0, 12));
      ranked = [...rrf.entries()].map(([c, s]) => ({ c, s })).sort((a, b) => b.s - a.s);
      mode = "hybrid";
    } catch (e: any) {
      console.warn(`[rag] query embedding failed (${e?.message}) — BM25 for this query`);
    }
  }
  const top = ranked.slice(0, k);
  const max = top[0]?.s || 1;
  return {
    mode,
    expandedQuery,
    hits: top.map(({ c, s }) => ({
      docId: c.doc.id,
      title: c.doc.title,
      type: c.doc.type,
      trust: c.doc.trust,
      section: c.section,
      heading: c.heading,
      cite: c.cite,
      score: Number((s / max).toFixed(3)),
      text: c.text,
      flagged: c.flagged,
    })),
  };
}

export const kbStats = () => ({
  documents: KNOWLEDGE_BASE.length,
  chunks: N,
  models: [...new Set(KNOWLEDGE_BASE.flatMap((d) => d.models).filter((m) => m !== "all"))],
  retrieval: emb.status === "ready" ? `hybrid (BM25 + ${emb.model})` : embCfg.model ? `BM25 (embeddings ${emb.status}${emb.error ? `: ${emb.error}` : ""})` : "BM25 (no embedding model configured)",
  flaggedChunks: chunks.filter((c) => c.flagged.length).map((c) => c.id),
  titles: KNOWLEDGE_BASE.map((d) => ({ id: d.id, title: d.title, type: d.type, chunks: d.chunks.length })),
});
