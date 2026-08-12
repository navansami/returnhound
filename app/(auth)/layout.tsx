import { Search } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-lg font-semibold">
        <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Search className="size-5" />
        </span>
        Lost &amp; Found
      </div>
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Royal Service · Fairmont The Palm
      </p>
    </div>
  );
}
