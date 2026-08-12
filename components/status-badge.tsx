import { cn } from "@/lib/utils";

type Status = "logged" | "enquired" | "collected" | "discarded" | "partially_collected";

const STYLES: Record<Status, string> = {
  logged: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  enquired: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  collected: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  discarded: "bg-muted text-muted-foreground",
  partially_collected: "bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300",
};

export const STATUS_DOT: Record<Status, string> = {
  logged: "bg-blue-500",
  enquired: "bg-amber-500",
  collected: "bg-emerald-500",
  discarded: "bg-zinc-400",
  partially_collected: "bg-purple-500",
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        STYLES[status],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
      {status.replaceAll("_", " ")}
    </span>
  );
}
