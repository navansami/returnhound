import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

/** First RS number for new entries (continues from your existing Excel logs). */
const RS_START = Number(process.env.RS_NUMBER_START ?? 1);

/** Allocate the next RS number (one number). */
export async function nextRsNumber(): Promise<string> {
  const [num] = await allocateRsNumbers(1);
  return num;
}

/**
 * Allocate `count` consecutive RS numbers in one atomic round trip.
 *
 * The counter lives in the `setting` table as `rs_counter` → `{"next": N}`.
 * The single INSERT … ON CONFLICT statement is atomic: concurrent calls
 * serialize on the row lock and each re-evaluates `value->>'next'` against the
 * latest committed row, so no two calls can ever share a number — even over
 * Neon's serverless HTTP transport (no explicit transactions needed).
 */
export async function allocateRsNumbers(count: number): Promise<string[]> {
  if (count <= 0) return [];
  const result = (await db.execute(sql`
    INSERT INTO setting (key, value, updated_at)
    VALUES ('rs_counter', jsonb_build_object('next', ${RS_START + count}::int), now())
    ON CONFLICT (key) DO UPDATE SET
      value = jsonb_build_object('next', (coalesce((setting.value->>'next')::int, ${RS_START}) + ${count})),
      updated_at = now()
    RETURNING (value->>'next')::int AS next
  `)) as unknown as { rows?: { next: number }[] };
  const row = result.rows?.[0] ?? (result as unknown as { next: number }[])[0];
  const newNext = Number(row?.next ?? RS_START + count);
  const start = newNext - count;
  return Array.from({ length: count }, (_, i) => `RS${String(start + i).padStart(4, "0")}`);
}

/**
 * Ensure the counter never issues a number below `minNext` again — used after
 * importing fixed RS numbers from Excel so the next new entry continues past
 * the highest one that already exists.
 */
export async function bumpRsCounterTo(minNext: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO setting (key, value, updated_at)
    VALUES ('rs_counter', jsonb_build_object('next', ${minNext}::int), now())
    ON CONFLICT (key) DO UPDATE SET
      value = jsonb_build_object('next', greatest(coalesce((setting.value->>'next')::int, 0), ${minNext}::int)),
      updated_at = now()
  `);
}
