import { cn } from "@/lib/utils/cn";
import type { ApplicationStatus } from "@/lib/types";

const STATUS_STYLES: Record<ApplicationStatus, string> = {
  draft: "bg-zinc-100 text-zinc-700",
  ready: "bg-blue-100 text-blue-700",
  applying: "bg-violet-100 text-violet-700",
  applied: "bg-emerald-100 text-emerald-700",
  interview: "bg-purple-100 text-purple-700",
  rejected: "bg-red-100 text-red-700",
  offer: "bg-amber-100 text-amber-700",
};

export function StatusBadge({
  status,
  className,
}: {
  status: ApplicationStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
        STATUS_STYLES[status],
        className
      )}
    >
      {status}
    </span>
  );
}
