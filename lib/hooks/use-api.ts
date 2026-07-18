"use client";

import { useCallback } from "react";
import { useAuth } from "@/components/auth/auth-provider";

export function useApi() {
  const { getIdToken } = useAuth();

  const apiFetch = useCallback(
    async <T = any>(path: string, options: RequestInit = {}): Promise<T> => {
      const token = await getIdToken();
      const headers: Record<string, string> = {
        ...(options.headers as Record<string, string>),
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (!(options.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
      }

      const res = await fetch(path, { ...options, headers });
      const contentType = res.headers.get("content-type") ?? "";
      const raw = await res.text();
      let data: unknown = null;
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          const snippet = raw.slice(0, 80).replace(/\s+/g, " ");
          throw new Error(
            contentType.includes("text/html") || raw.trimStart().startsWith("<!")
              ? `Server returned HTML instead of JSON (${res.status}). Check Vercel env vars / deployment logs.`
              : `Invalid JSON response (${res.status}): ${snippet}`
          );
        }
      }
      if (!res.ok) {
        const errMsg =
          data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error)
            : "Request failed";
        console.error(`[API] ${options.method ?? "GET"} ${path} failed:`, errMsg);
        throw new Error(errMsg);
      }
      return data as T;
    },
    [getIdToken]
  );

  return { apiFetch };
}
