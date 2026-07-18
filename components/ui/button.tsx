import { cn } from "@/lib/utils/cn";
import type { ButtonHTMLAttributes } from "react";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50",
        variant === "primary" && "bg-zinc-900 text-white hover:bg-zinc-800",
        variant === "secondary" && "border border-zinc-200 bg-white hover:bg-zinc-50",
        variant === "ghost" && "hover:bg-zinc-100",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className
      )}
      {...props}
    />
  );
}
