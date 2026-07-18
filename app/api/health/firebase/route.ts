import { NextRequest } from "next/server";
import { jsonOk, jsonError } from "@/lib/api/auth";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase/admin";

/**
 * Lightweight production check for Firebase Admin wiring.
 * Does not expose secrets — only whether credentials work.
 */
export async function GET(_request: NextRequest) {
  try {
    const projectId =
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
      "(missing NEXT_PUBLIC_FIREBASE_PROJECT_ID)";

    const hasInline = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim());
    const hasPath = Boolean(
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim() ||
        process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
    );

    // Touch Auth + Firestore so credential / network failures surface here.
    getAdminAuth();
    await getAdminFirestore().collection("profiles").limit(1).get();

    return jsonOk({
      ok: true,
      projectId,
      credentials: hasInline ? "FIREBASE_SERVICE_ACCOUNT_JSON" : hasPath ? "path" : "none",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Firebase check failed";
    console.error("[health/firebase]", e);
    return jsonError(message, 500);
  }
}
