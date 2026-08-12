import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
}

/**
 * Neon's serverless HTTP driver talks to the database over a single fetch call.
 * A paused instance cold-starting, or a momentary network glitch, makes that
 * fetch reject with "TypeError: fetch failed" even though the connection string
 * is fine — and it surfaces as a 500 on the first page load. Retry briefly with
 * backoff so those recover on their own.
 *
 * Only network-level failures are retried: SQL errors come back as HTTP 400
 * responses (i.e. a successful fetch) and are passed straight through, and an
 * AbortError means the caller cancelled, so neither is touched.
 */
function retryingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const attempts = 4;
  let lastError: unknown;

  async function run(): Promise<Response> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await fetch(input, init);
      } catch (err) {
        lastError = err;
        // An abort is deliberate — don't resurrect it.
        if (err instanceof Error && err.name === "AbortError") throw err;
        if (attempt === attempts - 1) throw lastError;
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
    throw lastError;
  }

  return run();
}

neonConfig.fetchFunction = retryingFetch;

const sql = neon(process.env.DATABASE_URL);

export const db = drizzle(sql, { schema });
export { schema };
