import { NextRequest } from "next/server";
import {
  requireAdmin,
  jsonError,
  jsonOk,
  AuthError,
} from "@/lib/api/auth";
import { listAllAiUsage } from "@/services/ai-usage";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return jsonOk(await listAllAiUsage());
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.message === "Admin access required" ? 403 : 401;
      return jsonError(e.message, status);
    }
    console.error("[admin/usage]", e);
    return jsonError("Failed to load usage", 500);
  }
}
