import { NextRequest } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";
import { isAdminEmail } from "@/lib/admin/config";

export interface AuthUser {
  uid: string;
  email: string | null;
}

export async function verifyAuthUser(request: NextRequest): Promise<AuthUser> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new AuthError("Missing authorization token");
  }

  const token = header.slice(7);
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
    };
  } catch {
    throw new AuthError("Invalid authorization token");
  }
}

export async function verifyAuth(request: NextRequest): Promise<string> {
  const user = await verifyAuthUser(request);
  return user.uid;
}

export async function requireAdmin(request: NextRequest): Promise<AuthUser> {
  const user = await verifyAuthUser(request);
  if (!isAdminEmail(user.email)) {
    throw new AuthError("Admin access required");
  }
  return user;
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
