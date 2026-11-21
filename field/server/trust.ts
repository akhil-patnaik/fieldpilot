/**
 * Trust the operating system's certificate store in addition to Node's bundled CA list.
 *
 * Why: on corporate networks a TLS-inspection proxy re-signs HTTPS with its own root CA. Browsers and curl
 * trust it (it's in the OS keychain); Node doesn't, so every outbound call — LLM, Agora, Murf — fails with
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE. Equivalent to `node --use-system-ca`, but automatic.
 * Imported first by server/index.ts so it runs before any network call. Opt out with SYSTEM_CA=0.
 */
import tls from "node:tls";

const t = tls as typeof tls & {
  getCACertificates?: (type: "default" | "system") => string[];
  setDefaultCACertificates?: (certs: string[]) => void;
};

if (process.env.SYSTEM_CA !== "0" && t.getCACertificates && t.setDefaultCACertificates) {
  try {
    t.setDefaultCACertificates([...new Set([...t.getCACertificates("default"), ...t.getCACertificates("system")])]);
  } catch (e) {
    console.warn("[trust] could not load the system certificate store:", (e as Error).message);
  }
}
