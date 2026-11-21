// Worker process: queues and schedules for collection, processing, events, reports and ops, and the site's
// modules (site/modules/server.ts).
import { assertProductionSecrets } from "@aihot/backend/config";
import { closeDb } from "@aihot/backend/db";
import { getBoss, stopBoss, workModuleQueues } from "@aihot/backend/jobs/queue";
import { installModules } from "@aihot/backend/modules";
import { SERVER_MODULES } from "@aihot/site/modules/server";
import { registerContentJobs } from "@aihot/backend/jobs/content";
import { registerSourceJobs } from "@aihot/backend/jobs/sources";
import { registerEventJobs } from "@aihot/backend/jobs/events";
import { registerNotifyJobs } from "@aihot/backend/jobs/notify";
import { registerPublicationJobs } from "@aihot/backend/jobs/publication";
import { registerSchedules } from "./schedules.ts";
import { ensureContentTargets } from "@aihot/backend/notify/deliver";
import { startHeartbeat } from "@aihot/backend/operations/heartbeat";
import {
  StartupAbortedError,
  extractErrorCode,
  retryStartupStep,
  sanitizeStartupErrorMessage,
} from "./startup.ts";

installModules(SERVER_MODULES);
assertProductionSecrets([["auth", "IMG_PROXY_SIGN_SECRET"]]);

const startupAbort = new AbortController();
let stopping = false;
let bossStarted = false;
let heartbeat: ReturnType<typeof setInterval> | null = null;

async function cleanupResources(gracefulBoss: boolean): Promise<void> {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  const timeout = setTimeout(() => {
    console.error(JSON.stringify({ level: "error", msg: "worker shutdown forced after timeout" }));
    process.exit(1);
  }, gracefulBoss ? 200_000 : 5_000);
  timeout.unref?.();

  try {
    if (gracefulBoss && bossStarted) {
      await stopBoss().catch((err) => {
        console.error(
          JSON.stringify({ level: "error", msg: "stopBoss failed", error: sanitizeStartupErrorMessage(err) })
        );
      });
    }
    await closeDb().catch((err) => {
      console.error(
        JSON.stringify({ level: "error", msg: "closeDb failed", error: sanitizeStartupErrorMessage(err) })
      );
    });
  } finally {
    clearTimeout(timeout);
  }
}

const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  startupAbort.abort();
  console.log(JSON.stringify({ level: "info", msg: "worker stopping" }));
  await cleanupResources(true);
  process.exit(0);
};

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});

process.on("unhandledRejection", (reason) => {
  if (stopping) return;
  stopping = true;
  startupAbort.abort();
  console.error(
    JSON.stringify({
      level: "error",
      msg: "worker unhandledRejection",
      code: extractErrorCode(reason),
      error: sanitizeStartupErrorMessage(reason),
    })
  );
  void cleanupResources(bossStarted).finally(() => process.exit(1));
});

process.on("uncaughtException", (err) => {
  if (stopping) return;
  stopping = true;
  startupAbort.abort();
  console.error(
    JSON.stringify({
      level: "error",
      msg: "worker uncaughtException",
      code: extractErrorCode(err),
      error: sanitizeStartupErrorMessage(err),
    })
  );
  void cleanupResources(bossStarted).finally(() => process.exit(1));
});

try {
  // 对连接类启动步骤执行有界指数退避重试；不在启动重试期调用 stopBoss() 以免污染全局 shutdownSignal。
  await retryStartupStep("ensureContentTargets", () => ensureContentTargets(), {
    signal: startupAbort.signal,
  });

  const boss = await retryStartupStep("getBoss", () => getBoss(), {
    signal: startupAbort.signal,
  });
  bossStarted = true;

  await registerContentJobs(boss);
  if (process.env.COLLECT_ENABLED === "true") await registerSourceJobs(boss);
  await registerEventJobs(boss);
  await registerNotifyJobs(boss);
  await registerPublicationJobs(boss);
  await workModuleQueues(boss);
  await registerSchedules(boss);

  if (!stopping) {
    heartbeat = startHeartbeat("worker");
    console.log(JSON.stringify({ level: "info", msg: "worker started", pid: process.pid }));
  }
} catch (err) {
  if (err instanceof StartupAbortedError || stopping) {
    await cleanupResources(false);
    process.exit(0);
  }
  console.error(
    JSON.stringify({
      level: "error",
      msg: "worker startup failed fatally",
      code: extractErrorCode(err),
      error: sanitizeStartupErrorMessage(err),
    })
  );
  // 若 getBoss 已成功后在队列注册阶段失败，直接关闭 DB 并以非零码退出，交由 run-all.mjs 拉起全新子进程。
  await cleanupResources(false);
  process.exit(1);
}
