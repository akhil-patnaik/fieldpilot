import { emit } from "./bus.ts";
import { config } from "./config.ts";

/**
 * Every call into an enterprise system goes through callSystem():
 *   per-attempt timeout  →  up to MAX_ATTEMPTS with exponential backoff + jitter  →  typed SystemError.
 * Chaos (CHAOS_FAILURE_RATE, or runtime controls) is injected BEFORE the operation runs, so a failed
 * attempt never half-applies a write and a retry can never double-apply it.
 */

export const SYSTEMS = ["FSM", "CMMS", "ERP", "IoT", "Calendar", "Notify"] as const;
export type SystemName = (typeof SYSTEMS)[number];
type Health = "ok" | "busy" | "degraded" | "down";

export const TIMEOUT_MS = Number(process.env.SYSTEM_TIMEOUT_MS ?? 1200);
export const MAX_ATTEMPTS = 3;

const chaos = {
  rate: Math.min(1, Math.max(0, config.chaosFailureRate)),
  failNext: {} as Record<string, number>,
  outage: new Set<string>(),
};

const health: Record<string, Health> = Object.fromEntries(SYSTEMS.map((s) => [s, "ok"]));
const inflight: Record<string, number> = {};

function setHealth(system: string, h: Health) {
  if (health[system] === h) return;
  health[system] = h;
  emit({ type: "systems", health: { ...health } });
}

export const systemHealth = () => ({ ...health });
export const chaosState = () => ({ rate: chaos.rate, failNext: { ...chaos.failNext }, outage: [...chaos.outage] });

export function setChaos(p: { rate?: number; failNext?: { system: string; count: number }; outage?: { system: string; on: boolean }; clear?: boolean }) {
  if (p.clear) {
    chaos.rate = 0;
    chaos.failNext = {};
    chaos.outage.clear();
    for (const s of SYSTEMS) setHealth(s, "ok");
  }
  if (typeof p.rate === "number") chaos.rate = Math.min(1, Math.max(0, p.rate));
  if (p.failNext) chaos.failNext[p.failNext.system] = Math.max(0, p.failNext.count);
  if (p.outage) {
    if (p.outage.on) chaos.outage.add(p.outage.system);
    else chaos.outage.delete(p.outage.system);
    setHealth(p.outage.system, p.outage.on ? "down" : "ok");
  }
  emit({ type: "chaos", chaos: chaosState() });
  return chaosState();
}

export class SystemError extends Error {
  constructor(
    public system: string,
    public kind: "timeout" | "unavailable" | "outage",
    message: string,
    public attempts = 1,
    public failures: string[] = [],
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failToggle = 0;
function injectedFault(system: string): "timeout" | "unavailable" | "outage" | null {
  if (chaos.outage.has(system)) return "outage";
  if ((chaos.failNext[system] ?? 0) > 0) {
    chaos.failNext[system]--;
    emit({ type: "chaos", chaos: chaosState() });
    return failToggle++ % 2 === 0 ? "timeout" : "unavailable";
  }
  if (chaos.rate > 0 && Math.random() < chaos.rate) return Math.random() < 0.5 ? "timeout" : "unavailable";
  return null;
}

function describe(system: string, kind: string) {
  return kind === "timeout"
    ? `${system} gateway timed out after ${TIMEOUT_MS}ms`
    : kind === "outage"
      ? `${system} is unavailable (outage)`
      : `${system} returned 503 Service Unavailable`;
}

export interface CallResult<T> {
  value: T;
  attempts: number;
  failures: string[];
}

export interface CallOpts {
  /** Tool-call id, so retries render inline in the timeline. */
  callId?: string;
  tool?: string;
  label?: string;
  timeoutMs?: number;
  maxAttempts?: number;
}

export async function callSystem<T>(system: string, fn: () => T | Promise<T>, opts: CallOpts = {}): Promise<CallResult<T>> {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const max = opts.maxAttempts ?? MAX_ATTEMPTS;
  const failures: string[] = [];
  inflight[system] = (inflight[system] ?? 0) + 1;
  if (health[system] === "ok") setHealth(system, "busy");
  try {
    for (let attempt = 1; ; attempt++) {
      const fault = injectedFault(system);
      try {
        const value = await new Promise<T>((resolve, reject) => {
          const timer = setTimeout(() => reject(new SystemError(system, "timeout", describe(system, "timeout"))), timeoutMs);
          (async () => {
            if (fault === "timeout") return; // simulate a hung upstream: never resolves → timer fires
            if (fault) throw new SystemError(system, fault, describe(system, fault));
            return fn();
          })().then(
            (v) => {
              if (fault === "timeout") return;
              clearTimeout(timer);
              resolve(v as T);
            },
            (e) => {
              clearTimeout(timer);
              reject(e);
            },
          );
        });
        setHealth(system, failures.length ? "degraded" : "ok");
        if (failures.length) setTimeout(() => health[system] === "degraded" && !chaos.outage.has(system) && setHealth(system, "ok"), 5000);
        return { value, attempts: attempt, failures };
      } catch (e: any) {
        // Business-rule errors (not SystemError) are not retried — they're answers, not outages.
        if (!(e instanceof SystemError)) throw e;
        failures.push(e.message);
        if (attempt >= max || e.kind === "outage") {
          setHealth(system, "down");
          if (!chaos.outage.has(system)) setTimeout(() => health[system] === "down" && setHealth(system, "ok"), 8000);
          throw new SystemError(system, e.kind, `${e.message} — gave up after ${attempt} attempt${attempt > 1 ? "s" : ""}`, attempt, failures);
        }
        const backoffMs = 200 * 2 ** (attempt - 1) + Math.round(Math.random() * 100);
        setHealth(system, "degraded");
        if (opts.callId)
          emit({ type: "tool", id: opts.callId, phase: "retry", name: opts.tool ?? system, label: opts.label ?? system, system, args: undefined, attempt, error: e.message, backoffMs });
        await sleep(backoffMs);
      }
    }
  } finally {
    inflight[system]--;
    if (!inflight[system] && health[system] === "busy") setHealth(system, "ok");
  }
}
