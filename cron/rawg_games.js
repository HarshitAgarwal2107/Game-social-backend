import cron from "node-cron";
import { syncRawgGames } from "../jobs/rawgSync.js";

let started = false;

export function startRawgCron({ runImmediately = false } = {}) {
  if (started) return;
  started = true;

  cron.schedule("0 3 * * *", async () => {
    console.log("[RAWG] Daily cron sync started");
    try {
      await syncRawgGames();
      console.log("[RAWG] Daily cron sync finished");
    } catch (err) {
      console.error("[RAWG] Cron sync failed", err);
    }
  });

  if (runImmediately) {
    (async () => {
      console.log("[RAWG] Startup stale-check sync");
      try {
        const { syncIfStale } = await import("../jobs/rawgSyncGuard.js");
        await syncIfStale();
      } catch (err) {
        console.error("[RAWG] Startup sync failed", err);
      }
    })();
  }
}
