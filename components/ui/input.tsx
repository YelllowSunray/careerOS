import { cn } from "@/lib/utils/cn";
import type { InputHTMLAttributes } from "react";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-base outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 sm:py-2 sm:text-sm",
        className
      )}
      {...props}
    />
  );
}
