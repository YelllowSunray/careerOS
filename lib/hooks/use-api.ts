"use client";

import { useCallback } from "react";
import { useAuth } from "@/components/auth/auth-provider";

export function useApi() {
  const { getIdToken } = useAuth();

  const apiFetch = useCallback(
    async (path: string, options: RequestInit = {}) => {
      const token = await getIdToken();
      const headers: Record<string, string> = {
        ...(options.headers as Record<string, string>),
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (!(options.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
      }

      const res = await fetch(path, { ...options, headers });
      const data = await res.json();
      if (!res.ok) {
        console.error(`[API] ${options.method ?? "GET"} ${path} failed:`, data.error ?? data);
        throw new Error(data.error ?? "Request failed");
      }
      return data;
    },
    [getIdToken]
  );

  return { apiFetch };
}
