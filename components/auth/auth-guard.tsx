"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";

const PUBLIC_PATHS = ["/login", "/signup"];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user && !PUBLIC_PATHS.includes(pathname)) {
      router.replace("/login");
    }
    if (user && PUBLIC_PATHS.includes(pathname)) {
      router.replace("/profile");
    }
  }, [user, loading, pathname, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900" />
      </div>
    );
  }

  if (!user && !PUBLIC_PATHS.includes(pathname)) return null;
  return <>{children}</>;
}
