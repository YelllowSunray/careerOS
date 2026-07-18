import { NextRequest } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";

export async function verifyAuth(request: NextRequest): Promise<string> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new AuthError("Missing authorization token");
  }

  const token = header.slice(7);
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    throw new AuthError("Invalid authorization token");
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export function jsonOk<T>(data: T, status = 200) {
  return Response.json(data, { status });
}
