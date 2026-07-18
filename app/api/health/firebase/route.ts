export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Always returns JSON — even on failure — so we can debug Vercel credentials.
 * Does not expose secrets.
 */
export async function GET() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "";
  const trimmed = raw.trim();
  const base = {
    ok: false as boolean,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? null,
    hasServiceAccountEnv: trimmed.length > 0,
    serviceAccountEnvLength: trimmed.length,
    serviceAccountEnvPrefix: trimmed.slice(0, 16),
  };

  try {
    if (!trimmed) {
      return Response.json(
        {
          ...base,
          error:
            "FIREBASE_SERVICE_ACCOUNT_JSON is missing on this deployment",
        },
        { status: 500 }
      );
    }

    const { getAdminAuth, getAdminFirestore } = await import(
      "@/lib/firebase/admin"
    );

    getAdminAuth();
    await getAdminFirestore().collection("profiles").limit(1).get();

    return Response.json({
      ...base,
      ok: true,
      credentials: "FIREBASE_SERVICE_ACCOUNT_JSON",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Firebase check failed";
    console.error("[health/firebase]", e);
    return Response.json({ ...base, error: message }, { status: 500 });
  }
}
