import fs from "node:fs";
import path from "node:path";
import { buildSeed, type EnterpriseState } from "./seed.ts";
import { emit } from "./bus.ts";

const DATA_DIR = path.resolve(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "state.json");

let state: EnterpriseState = load();

function load(): EnterpriseState {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    /* fall through to seed */
  }
  return buildSeed();
}

let saveTimer: NodeJS.Timeout | null = null;
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
  }, 200);
}

export const db = {
  get: () => state,
  /** Mutate enterprise state and broadcast which systems/records changed. */
  mutate<T>(changed: (keyof EnterpriseState)[], highlight: string[], fn: (s: EnterpriseState) => T): T {
    const out = fn(state);
    persist();
    emit({ type: "state", changed: changed as string[], highlight });
    return out;
  },
  nextId(prefix: string) {
    state.counters[prefix] = (state.counters[prefix] ?? 0) + 1;
    return `${prefix}-${state.counters[prefix]}`;
  },
  reset() {
    state = buildSeed();
    persist();
    emit({ type: "state", changed: ["*"], highlight: [] });
  },
};
