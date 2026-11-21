import "dotenv/config";
import { createHash } from "node:crypto";

const env = (k: string, d = "") => (process.env[k] ?? d).trim();

export const config = {
  port: Number(env("PORT", "8787")),
  publicUrl: env("PUBLIC_URL").replace(/\/$/, ""),
  llm: {
    baseURL: env("LLM_BASE_URL", "https://api.openai.com/v1"),
    apiKey: env("LLM_API_KEY"),
    model: env("LLM_MODEL", "gpt-4.1-mini"),
  },
  agora: {
    appId: env("AGORA_APP_ID"),
    appCertificate: env("AGORA_APP_CERTIFICATE"),
    customerId: env("AGORA_CUSTOMER_ID"),
    customerSecret: env("AGORA_CUSTOMER_SECRET"),
    asrLanguage: env("AGORA_ASR_LANGUAGE", "en-US"),
  },
  murf: {
    apiKey: env("MURF_API_KEY"),
    voiceId: env("MURF_VOICE_ID", "Matthew"),
    locale: env("MURF_LOCALE", "en-US"),
    model: env("MURF_MODEL", "falcon-2.1"),
  },
  /**
   * Embeddings for RAG via the configured OpenAI-compatible provider. Enabled when EMBEDDING_MODEL is set,
   * or automatically with text-embedding-3-small when the LLM provider is OpenAI. Otherwise BM25 only.
   */
  embeddings: {
    baseURL: env("EMBEDDING_BASE_URL") || env("LLM_BASE_URL", "https://api.openai.com/v1"),
    apiKey: env("EMBEDDING_API_KEY") || env("LLM_API_KEY"),
    model: env("EMBEDDING_MODEL") || (/api\.openai\.com/.test(env("EMBEDDING_BASE_URL") || env("LLM_BASE_URL", "https://api.openai.com/v1")) && env("LLM_API_KEY") ? "text-embedding-3-small" : ""),
  },
  approvalLimitUsd: Number(env("APPROVAL_LIMIT_USD", "750")),
  chaosFailureRate: Number(env("CHAOS_FAILURE_RATE", "0")),
  /** Shared secret Agora presents when calling our custom LLM endpoint. */
  // Stable across dev-server restarts so a live Agora agent keeps authenticating.
  llmProxySecret:
    env("LLM_PROXY_SECRET") || `fp_${createHash("sha256").update(`${env("AGORA_APP_CERTIFICATE")}:${env("LLM_API_KEY")}:fieldpilot`).digest("hex").slice(0, 32)}`,
};

const llmConfigured = () => Boolean(config.llm.apiKey) || /localhost|127\.0\.0\.1/.test(config.llm.baseURL);

/**
 * Runtime switches. Backup mode routes the agent to the built-in scripted brain (server/backupBrain.ts):
 * deterministic, offline, knows the demo story. On automatically when no LLM is configured; toggle any time.
 */
export const runtime = {
  selfUrl: `http://127.0.0.1:${config.port}`,
  backup: env("BACKUP_MODE") === "1" || (!llmConfigured() && env("BACKUP_MODE") !== "0"),
};

export const capabilities = () => ({
  llm: llmConfigured(),
  backup: runtime.backup,
  agora: Boolean(config.agora.appId && config.agora.appCertificate),
  agoraReachable: Boolean(config.agora.appId && config.agora.appCertificate && config.publicUrl),
  murf: Boolean(config.murf.apiKey),
  model: config.llm.model,
  voice: config.murf.voiceId,
  publicUrl: config.publicUrl || null,
});
