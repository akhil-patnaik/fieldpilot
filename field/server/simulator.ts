import { db } from "./store.ts";
import { emit } from "./bus.ts";

/**
 * Demo simulation driver (no keys needed): a simulation clock plus scenarios that drift telemetry live.
 *   • head_pressure_rising — Mercy General CH-3 head pressure climbs toward the 425 psi HP-02 trip while
 *     fan #3 current sags; it falls back when the chiller is put in Head Pressure Limit mode.
 *   • safety event — a danger-band reading on the job the technician is at (fan control panel overheating).
 * Each tick advances the simulation clock by `speed` minutes and appends timestamped samples that the
 * Watchtower trend detector fits.
 */

const sim = {
  offsetMs: 0,
  /** Simulated minutes per real second. */
  speed: 2,
  scenarios: new Set<string>(),
  timer: null as NodeJS.Timeout | null,
  ticks: 0,
};

export const simNow = () => Date.now() + sim.offsetMs;
export const simState = () => ({ speed: sim.speed, scenarios: [...sim.scenarios], simTime: new Date(simNow()).toISOString(), offsetMinutes: Math.round(sim.offsetMs / 60000), ticks: sim.ticks });
const publish = () => emit({ type: "sim", sim: simState() });

function point(assetId: string, metric: string) {
  return db.get().telemetry[assetId]?.points.find((p) => p.metric === metric);
}

function status(metric: string, v: number): "OK" | "WARN" | "CRITICAL" {
  const m = metric.toLowerCase();
  if (m.includes("discharge")) return v > 380 ? "CRITICAL" : v > 340 ? "WARN" : "OK";
  if (m.includes("current")) return v < 1 ? "CRITICAL" : v < 2.6 ? "WARN" : "OK";
  if (m.includes("panel temp")) return v >= 85 ? "CRITICAL" : v >= 60 ? "WARN" : "OK";
  return "OK";
}

function push(p: { samples?: [number, number][]; value: number }, v: number) {
  p.samples ??= [];
  p.samples.push([simNow(), v]);
  if (p.samples.length > 240) p.samples.splice(0, p.samples.length - 240);
}

function tick() {
  sim.ticks++;
  sim.offsetMs += sim.speed * 60_000 - 1000; // real second already elapsed → clock moves `speed` minutes per second
  if (sim.scenarios.has("head_pressure_rising")) {
    const id = "A-CH-310";
    db.mutate(["telemetry"], [id], (s) => {
      const tel = s.telemetry[id];
      const dp = tel.points.find((p) => p.metric === "Discharge pressure")!;
      const fan = tel.points.find((p) => p.metric === "Condenser fan #3 current");
      const limited = tel.mode === "HEAD_PRESSURE_LIMIT";
      const noise = (Math.random() - 0.5) * 0.6;
      dp.value = Number((limited ? Math.max(355, dp.value - 4 * sim.speed) : Math.min(431, dp.value + 2.2 * sim.speed + noise)).toFixed(1));
      dp.status = status(dp.metric, dp.value);
      push(dp, dp.value);
      if (fan && !limited) {
        fan.value = Number(Math.max(0.6, fan.value - 0.025 * sim.speed).toFixed(2));
        fan.status = status(fan.metric, fan.value);
        push(fan, fan.value);
      }
      if (dp.value >= 425 && !limited) {
        const f = tel.activeFaults.find((x) => x.code === "HP-02");
        if (f && Date.now() - new Date(f.lastAt).getTime() > 20_000) {
          f.count24h++;
          f.lastAt = new Date().toISOString();
        }
      }
      tel.updatedAt = new Date().toISOString();
    });
  }
  publish();
}

function ensureTimer() {
  if (sim.timer || !sim.scenarios.size) return;
  sim.timer = setInterval(tick, 1000);
}

export function startScenario(name: "head_pressure_rising") {
  if (name === "head_pressure_rising") {
    // Seed the live series with the current value so the detector has a starting point.
    const dp = point("A-CH-310", "Discharge pressure");
    if (dp) db.mutate(["telemetry"], ["A-CH-310"], (s) => {
      s.telemetry["A-CH-310"].mode = undefined;
      push(dp, dp.value);
    });
  }
  sim.scenarios.add(name);
  ensureTimer();
  publish();
  return simState();
}

/** Put a danger-band reading on an asset (default: the job the technician is at). */
export function triggerSafety(assetId = "A-CH-220") {
  const p = point(assetId, "Fan control panel temp");
  if (!p) return { error: `${assetId} has no panel temperature sensor` };
  db.mutate(["telemetry"], [assetId], (s) => {
    const q = s.telemetry[assetId].points.find((x) => x.metric === "Fan control panel temp")!;
    q.value = 92;
    q.status = "CRITICAL";
    push(q, 92);
    s.telemetry[assetId].updatedAt = new Date().toISOString();
  });
  publish();
  return { ok: true, assetId, metric: "Fan control panel temp", value: 92 };
}

export function stopScenarios() {
  sim.scenarios.clear();
  if (sim.timer) clearInterval(sim.timer);
  sim.timer = null;
  publish();
  return simState();
}

export function setSpeed(minutesPerSecond: number) {
  sim.speed = Math.min(30, Math.max(0.5, minutesPerSecond));
  publish();
  return simState();
}

export function resetSim() {
  stopScenarios();
  sim.offsetMs = 0;
  sim.ticks = 0;
  sim.speed = 2;
  publish();
}

/** Run one tick synchronously (tests). */
export const stepSim = () => tick();
