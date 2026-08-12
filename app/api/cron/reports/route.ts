import { NextResponse } from "next/server";

import { runDailyReport } from "@/server/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Accept Vercel cron invocations (x-vercel-cron header) or an explicit Bearer secret. */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (request.headers.get("x-vercel-cron") === "1") return true;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth === `Bearer ${secret}`) return true;
  }
  return !secret; // no secret configured → open (local dev only)
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await runDailyReport();
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, sentTo: result.sentTo });
}
