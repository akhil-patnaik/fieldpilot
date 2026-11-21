export type AgentState = "idle" | "listening" | "thinking" | "speaking";
export type Stage = "before" | "during" | "action" | "after";

export interface TranscriptItem {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  final: boolean;
  source: string;
}

export interface ToolEvent {
  id: string;
  name: string;
  label: string;
  system: string;
  args: any;
  result?: any;
  ok?: boolean;
  ms?: number;
  retries?: number;
  risk?: "low" | "medium" | "high";
  phase: "start" | "end";
  at: number;
  retryLog?: { attempt: number; error: string; backoffMs: number }[];
}

export type Health = "ok" | "busy" | "degraded" | "down";

export interface Insight {
  id: string;
  kind: string;
  dedupeKey: string;
  severity: "info" | "warning" | "critical" | "safety";
  confidence: number;
  title: string;
  why: string;
  evidence: { label: string; value: string; ref?: string; source?: string }[];
  action?: { label: string; readback: string; offer: string; costUsd?: number; etaMinutes?: number; steps: { tool: string; args: Record<string, unknown> }[] };
  ticketId?: string;
  status: "new" | "accepted" | "dismissed" | "acted";
  createdAt: string;
  announcedAt?: string;
  pendingActionId?: string;
  hold?: string;
  components?: { kind: string; title: string }[];
}
export interface InsightStats {
  shown: number;
  accepted: number;
  dismissed: number;
  acted: number;
  precision: number | null;
}
export interface SimState {
  speed: number;
  scenarios: string[];
  simTime: string;
  offsetMinutes: number;
  ticks: number;
}
export interface Chaos {
  rate: number;
  failNext: Record<string, number>;
  outage: string[];
}
export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  origin: string;
  tool: string;
  system: string;
  risk: "low" | "medium" | "high";
  summary: string;
  status: "EXECUTED" | "PENDING_CONFIRMATION" | "REJECTED" | "BLOCKED" | "FAILED" | "QUEUED";
  confirmedBy?: string;
  retries?: number;
  ms?: number;
}

export interface Pending {
  id: string;
  tool: string;
  summary: string;
  readback?: string;
  costUsd?: number;
  etaMinutes?: number;
  details: { label: string; value: string }[];
  risk: "MEDIUM" | "HIGH";
  createdAt: string;
}

export interface Metrics {
  turns: number;
  toolCalls: number;
  actionsExecuted: number;
  systemsTouched: number;
  systems: Record<string, number>;
  manualMinutesSaved: number;
  avgToolLatencyMs: number;
  avgFirstTokenMs: number;
  retriesRecovered: number;
  confirmationsRequested: number;
  sessionSeconds: number;
  insights?: InsightStats;
}

export interface Capabilities {
  llm: boolean;
  backup?: boolean;
  agora: boolean;
  agoraReachable: boolean;
  murf: boolean;
  model: string;
  voice: string;
  publicUrl: string | null;
}

export interface SessionInfo {
  id: string;
  mode: "agora" | "direct";
  channel?: string;
  agentId?: string;
  activeTicketId?: string;
  stage: Stage;
}

// Enterprise state (mirrors server/seed.ts)
export interface EState {
  technician: { id: string; name: string; vanId: string; region: string; manager: { name: string } };
  sites: { id: string; name: string; address: string; contact: { name: string; role?: string; phone?: string } }[];
  assets: { id: string; siteId: string; name: string; manufacturer: string; model: string; serial?: string }[];
  maintenance: { id: string; assetId: string; date: string; type: string; technician: string; faultCode?: string; summary: string; partsReplaced: string[]; notes: string }[];
  reservations: { id: string; ticketId: string; partNumber: string; qty: number; location: string; locationName: string; createdAt: string; status: string }[];
  audit: AuditEntry[];
  chaos?: Chaos;
  health?: Record<string, Health>;
  approvalLimitUsd?: number;
  tickets: {
    id: string;
    title: string;
    priority: "P1" | "P2" | "P3";
    status: string;
    siteId: string;
    assetId: string;
    slaDueAt: string;
    businessImpact?: string;
    notes: { at: string; by: string; text: string }[];
    diagnosis?: { rootCause: string };
    linkedPOs: string[];
    linkedIncidents: string[];
    followUps: string[];
    reportId?: string;
    onSiteAt?: string;
    closedAt?: string;
    resolution?: string;
  }[];
  telemetry: Record<string, { updatedAt: string; points: { metric: string; unit: string; value: number; expected: string; status: string; trend7d?: number[] }[]; activeFaults: { code: string; count24h: number }[] }>;
  parts: { partNumber: string; description: string; unitPriceUsd: number; alternates?: string[]; stock: { location: string; locationName: string; qty: number; holder?: string }[] }[];
  purchaseOrders: {
    id: string;
    ticketId: string;
    createdAt: string;
    lines: { partNumber: string; qty: number; description: string; unitPriceUsd: number; sourceLocation?: string }[];
    totalUsd: number;
    status: string;
    approver?: string;
    approvedBy?: string;
    erpAttempts?: number;
    note?: string;
    delivery: { method: string; fromLocation: string; etaMinutes: number; feeUsd: number };
  }[];
  incidents: { id: string; ticketId: string; severity: string; team: string; assignee: string; reason: string; status: string; createdAt: string }[];
  calendar: { id: string; start: string; end: string; title: string; kind: string }[];
  notifications: { id: string; at: string; channel: string; to: string; subject: string; body: string }[];
  reports: { id: string; ticketId: string; createdAt: string; summary: string; data?: { timeOnSite: { minutes: number }; citations: { cite: string; docId: string }[]; partsUsed: { qty: number }[] } }[];
  returns: { id: string; ticketId: string; createdAt: string; parts: { partNumber: string; description: string; qty: number; condition: string }[]; reason: string; returnTo: string; dueBy: string; assignee: string; status: string }[];
}
