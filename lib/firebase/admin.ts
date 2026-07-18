import { readFileSync } from "fs";
import { initializeApp, getApps, cert, type App, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";
import { getAuth, type Auth } from "firebase-admin/auth";

let adminApp: App | null = null;

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseServiceAccountJson(raw: string): ServiceAccount {
  const cleaned = stripWrappingQuotes(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Vercel-friendly alternative: base64-encoded JSON
    try {
      const decoded = Buffer.from(cleaned, "base64").toString("utf8");
      parsed = JSON.parse(decoded);
    } catch {
      throw new Error(
        "FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the full service-account file contents (starts with {\"type\":\"service_account\"…}), or a base64 encoding of that JSON."
      );
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must be a JSON object");
  }

  const o = parsed as Record<string, unknown>;
  const projectId = String(o.project_id ?? o.projectId ?? "");
  const clientEmail = String(o.client_email ?? o.clientEmail ?? "");
  let privateKey = String(o.private_key ?? o.privateKey ?? "");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is missing project_id, client_email, or private_key"
    );
  }

  // Some paste paths turn escaped newlines into the literal two-char sequence incorrectly;
  // others need \\n → real newlines for the PEM parser.
  if (privateKey.includes("\\n") && !privateKey.includes("\n")) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON private_key looks invalid (missing BEGIN PRIVATE KEY)"
    );
  }

  return {
    projectId,
    clientEmail,
    privateKey,
  };
}

function loadServiceAccount(): ServiceAccount | null {
  const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inlineJson?.trim()) {
    return parseServiceAccountJson(inlineJson);
  }

  const credentialsPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ??
    process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialsPath) {
    return parseServiceAccountJson(readFileSync(credentialsPath, "utf8"));
  }

  return null;
}

function getAdminApp(): App {
  if (adminApp) return adminApp;

  if (getApps().length > 0) {
    adminApp = getApps()[0]!;
    return adminApp;
  }

  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    throw new Error(
      "Firebase Admin credentials missing. Set FIREBASE_SERVICE_ACCOUNT_JSON on Vercel (or FIREBASE_SERVICE_ACCOUNT_PATH locally)."
    );
  }

  adminApp = initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.projectId,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });

  return adminApp;
}

export function getAdminFirestore(): Firestore {
  return getFirestore(getAdminApp());
}

export function getAdminStorage(): Storage {
  return getStorage(getAdminApp());
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}
