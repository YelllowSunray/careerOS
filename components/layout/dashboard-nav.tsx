"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { isAdminEmail } from "@/lib/admin/config";
import { cn } from "@/lib/utils/cn";
import {
  Briefcase,
  FileText,
  LayoutDashboard,
  LogOut,
  Settings,
  Shield,
  User,
} from "lucide-react";

const NAV = [
  { href: "/profile", label: "Profile", icon: User },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/applications", label: "Applications", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

function navActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardNav() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const showAdmin = isAdminEmail(user?.email);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-zinc-200 bg-white md:flex">
        <div className="flex items-center gap-2 border-b border-zinc-200 px-6 py-5">
          <LayoutDashboard className="h-5 w-5" />
          <span className="font-semibold">Career OS</span>
        </div>
        <nav className="flex-1 space-y-1 p-4">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                navActive(pathname, href)
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-100"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          ))}
          {showAdmin && (
            <Link
              href="/admin"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                navActive(pathname, "/admin")
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-100"
              )}
            >
              <Shield className="h-4 w-4 shrink-0" />
              Admin
            </Link>
          )}
        </nav>
        <div className="border-t border-zinc-200 p-4">
          <button
            type="button"
            onClick={() => logout()}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-5 w-5" />
          <span className="font-semibold">Career OS</span>
        </div>
        <div className="flex items-center gap-1">
          {showAdmin && (
            <Link
              href="/admin"
              className={cn(
                "rounded-lg p-2 text-zinc-600",
                navActive(pathname, "/admin") && "bg-zinc-100 text-zinc-900"
              )}
              aria-label="Admin"
            >
              <Shield className="h-5 w-5" />
            </Link>
          )}
          <button
            type="button"
            onClick={() => logout()}
            className="rounded-lg p-2 text-zinc-600"
            aria-label="Sign out"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Mobile bottom tabs */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-stretch justify-around px-1 pt-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = navActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-[10px] font-medium",
                  active ? "text-zinc-900" : "text-zinc-500"
                )}
              >
                <Icon
                  className={cn(
                    "h-5 w-5",
                    active ? "text-zinc-900" : "text-zinc-400"
                  )}
                />
                <span className="truncate">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
