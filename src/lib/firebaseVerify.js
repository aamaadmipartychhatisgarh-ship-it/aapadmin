import { X509Certificate, verify as cryptoVerify } from "crypto";
import { getSettings } from "@/lib/appSettings";

// Server-side verification of a Firebase Phone-Auth ID token, WITHOUT the
// firebase-admin SDK or a service-account secret. A Firebase ID token is an
// RS256 JWT signed by Google; we verify it against Google's rotating public
// certs and validate the standard claims (aud = our project, iss = Google's
// securetoken issuer, not expired). The only config needed is the (non-secret)
// Firebase project id, read from env or the app_settings table.
//
// This replaces backend OTP generation/sending/verification entirely: Firebase
// delivers and checks the SMS code; we only trust the resulting token and read
// the verified phone number from it (§2, §5).

const CERT_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let certCache = { certs: null, exp: 0 };

async function googleCerts() {
  if (certCache.certs && Date.now() < certCache.exp) return certCache.certs;
  const r = await fetch(CERT_URL);
  if (!r.ok) throw new Error(`cert fetch ${r.status}`);
  const certs = await r.json();
  const cc = r.headers.get("cache-control") || "";
  const m = /max-age=(\d+)/.exec(cc);
  const ttl = m ? Math.max(60, Number(m[1])) * 1000 : 3600 * 1000;
  certCache = { certs, exp: Date.now() + ttl };
  return certs;
}

const b64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

const FIREBASE_KEYS = ["FIREBASE_API_KEY", "FIREBASE_AUTH_DOMAIN", "FIREBASE_PROJECT_ID", "FIREBASE_APP_ID", "FIREBASE_MESSAGING_SENDER_ID"];
// API_KEY, AUTH_DOMAIN, PROJECT_ID and APP_ID are required to initialise the web
// SDK; messagingSenderId is optional.
const FIREBASE_REQUIRED = ["FIREBASE_API_KEY", "FIREBASE_AUTH_DOMAIN", "FIREBASE_PROJECT_ID", "FIREBASE_APP_ID"];

// Detailed load: the merged env+DB config PLUS status flags for diagnosis. Only
// booleans / key NAMES are surfaced — never a config value — so callers can log
// safely (§6, §11). `source` says where each present value came from.
export async function getFirebaseConfigDetailed() {
  let db = {}, dbOk = false, dbError = null;
  try { db = await getSettings(FIREBASE_KEYS); dbOk = true; }
  catch (e) { dbError = e?.message || String(e); }
  const cfg = {}, source = {};
  for (const k of FIREBASE_KEYS) {
    const envV = (process.env[k] || "").trim();
    const dbV = (db[k] || "").trim();
    cfg[k] = envV || dbV;
    source[k] = envV ? "env" : (dbV ? "db" : "none");
  }
  const missing = FIREBASE_REQUIRED.filter((k) => !cfg[k]);
  return { cfg, dbOk, dbError, missing, source, configured: missing.length === 0 };
}

export async function getFirebaseConfig() {
  const { cfg } = await getFirebaseConfigDetailed();
  return cfg;
}

// → { ok:true, phone, uid } | { ok:false, error }
export async function verifyFirebaseIdToken(idToken) {
  const { FIREBASE_PROJECT_ID: projectId } = await getFirebaseConfig();
  if (!projectId) return { ok: false, error: "firebase-not-configured" };

  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) return { ok: false, error: "malformed-token" };

  let header, payload;
  try {
    header = JSON.parse(b64url(parts[0]).toString("utf8"));
    payload = JSON.parse(b64url(parts[1]).toString("utf8"));
  } catch { return { ok: false, error: "malformed-token" }; }

  if (header.alg !== "RS256" || !header.kid) return { ok: false, error: "bad-algorithm" };

  let certs;
  try { certs = await googleCerts(); } catch (e) { return { ok: false, error: `certs-unavailable: ${e.message}` }; }
  const cert = certs[header.kid];
  if (!cert) return { ok: false, error: "unknown-signing-key" };

  let valid = false;
  try {
    const pub = new X509Certificate(cert).publicKey;
    valid = cryptoVerify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`, "utf8"), pub, b64url(parts[2]));
  } catch (e) { return { ok: false, error: `signature-check-failed: ${e.message}` }; }
  if (!valid) return { ok: false, error: "bad-signature" };

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) return { ok: false, error: "expired" };
  if (payload.iat && payload.iat > now + 300) return { ok: false, error: "issued-in-future" };
  if (payload.aud !== projectId) return { ok: false, error: "wrong-project" };
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) return { ok: false, error: "wrong-issuer" };
  if (!payload.sub) return { ok: false, error: "no-subject" };

  return { ok: true, phone: payload.phone_number || null, uid: payload.sub };
}
