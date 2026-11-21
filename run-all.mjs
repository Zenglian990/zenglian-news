import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const PLACEHOLDER_SECRET_REGEX = /^(changeme|placeholder|dummy|test|xxx+|your[-_ ].*|<.*>)$/i;
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

export const DEFAULT_API_READY_TIMEOUT_MS = 120_000;
export const DEFAULT_API_HEALTH_REQUEST_TIMEOUT_MS = 5_000;
export const DEFAULT_API_HEALTH_POLL_INTERVAL_MS = 500;
export const DEFAULT_CURATOR_INTERVAL_MS = 15 * 60 * 1000;
export const DEFAULT_CURATOR_BOOT_DELAY_MS = 10_000;
export const DEFAULT_CURATOR_TIMEOUT_MS = 12 * 60 * 1000;
export const DEFAULT_CURATOR_FORCE_KILL_DELAY_MS = 5_000;
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 200_000;
export const DEFAULT_WEB_STOP_TIMEOUT_MS = 10_000;
export const DEFAULT_API_STOP_TIMEOUT_MS = 10_000;

/** 判断当前是否处于生产环境或 Cloud Run 运行时。 */
export function isProductionRuntime(env = process.env) {
  return (
    env.NODE_ENV === "production" ||
    Boolean(env.K_SERVICE) ||
    Boolean(env.CLOUD_RUN_JOB)
  );
}

/** 从可选的 .env 文件向目标 env 对象补充缺失的环境变量（不覆盖已有值）。 */
export function loadDotEnvIfExists(rootDir, env = process.env) {
  const envPath = path.join(rootDir, ".env");
  if (!existsSync(envPath)) return false;
  const parsed = parseEnv(readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if ((env[key] === undefined || env[key] === "") && typeof value === "string") {
      env[key] = value;
    }
  }
  return true;
}

/** 校验密钥值是否满足最小长度且非占位符。 */
function isValidSecret(value, minLength = 8) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < minLength) return false;
  if (PLACEHOLDER_SECRET_REGEX.test(trimmed)) return false;
  return true;
}

/** 校验并解析数据库连接字符串及生产关键环境变量（Fail-Fast）。 */
export function validateRuntimeEnv(env = process.env) {
  const errors = [];
  const production = isProductionRuntime(env);
  const databaseUrl = (env.DATABASE_URL || "").trim();

  if (!databaseUrl) {
    errors.push("Missing required environment variable DATABASE_URL");
  } else {
    let parsedDb = null;
    try {
      parsedDb = new URL(databaseUrl);
    } catch {
      errors.push("DATABASE_URL must be a valid PostgreSQL connection URL");
    }
    if (parsedDb) {
      if (parsedDb.protocol !== "postgres:" && parsedDb.protocol !== "postgresql:") {
        errors.push("DATABASE_URL must use postgres:// or postgresql:// protocol");
      }
      if (production) {
        const host = parsedDb.hostname.toLowerCase();
        const password = decodeURIComponent(parsedDb.password || "");
        if (LOCAL_HOSTNAMES.has(host)) {
          errors.push("DATABASE_URL must not point to localhost/127.0.0.1 in production");
        }
        if (password && PLACEHOLDER_SECRET_REGEX.test(password)) {
          errors.push("DATABASE_URL contains a placeholder credential in production");
        }
      }
    }
  }

  if (production) {
    if (!isValidSecret(env.SESSION_SECRET, 8)) {
      errors.push("SESSION_SECRET must be set (>= 8 chars, non-placeholder) in production");
    }
    if (!isValidSecret(env.IMG_PROXY_SIGN_SECRET, 8)) {
      errors.push("IMG_PROXY_SIGN_SECRET must be set (>= 8 chars, non-placeholder) in production");
    }

    const siteUrlRaw = (env.SITE_URL || "").trim();
    if (!siteUrlRaw) {
      errors.push("SITE_URL must be set in production");
    } else {
      try {
        const parsedSite = new URL(siteUrlRaw);
        if (parsedSite.protocol !== "http:" && parsedSite.protocol !== "https:") {
          errors.push("SITE_URL must use http: or https: protocol");
        } else if (LOCAL_HOSTNAMES.has(parsedSite.hostname.toLowerCase())) {
          errors.push("SITE_URL must not point to localhost or 127.0.0.1 in production");
        }
      } catch {
        errors.push("SITE_URL must be a valid http(s) URL");
      }
    }

    const feishuConfigured = Boolean(
      (env.FEISHU_LOGIN_APP_ID || "").trim() && (env.FEISHU_LOGIN_APP_SECRET || "").trim()
    );
    const hasAdminPassword = Boolean((env.ADMIN_PASSWORD || "").trim());
    if (!feishuConfigured || hasAdminPassword) {
      if (!isValidSecret(env.ADMIN_PASSWORD, 12)) {
        errors.push(
          "ADMIN_PASSWORD must be set (>= 12 chars, non-placeholder) in production unless Feishu login is configured"
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Runtime environment validation failed:\n- ${errors.join("\n- ")}`);
  }
}

/** 解析 API / Web 端口、主机绑定与云环境标识。 */
export function resolveRuntimeConfig(env = process.env) {
  const apiPort = String(env.API_PORT || "3001");
  const apiHost = String(env.API_HOST || "127.0.0.1");
  const apiConnectHost = apiHost === "0.0.0.0" || apiHost === "::" ? "127.0.0.1" : apiHost;
  const apiBaseUrl = `http://${apiConnectHost}:${apiPort}`;
  const apiHealthUrl = `${apiBaseUrl}/api/health`;

  const hasPlatformPort = Boolean(env.PORT);
  const webPort = String(env.PORT || env.WEB_PORT || "3000");
  const webHost = String(env.WEB_HOST || (hasPlatformPort ? "0.0.0.0" : "127.0.0.1"));

  const isCloudRun = Boolean(env.K_SERVICE || env.CLOUD_RUN_JOB);
  const cloudRunService = env.K_SERVICE || env.CLOUD_RUN_JOB || null;
  const isCloud = Boolean(isCloudRun || env.RENDER || env.KOYEB || env.IS_CLOUD);

  const shutdownTimeoutRaw = Number.parseInt(env.SHUTDOWN_TIMEOUT_MS || "", 10);
  const shutdownTimeoutMs =
    Number.isFinite(shutdownTimeoutRaw) && shutdownTimeoutRaw > 0
      ? shutdownTimeoutRaw
      : DEFAULT_SHUTDOWN_TIMEOUT_MS;

  return {
    apiPort,
    apiHost,
    apiBaseUrl,
    apiHealthUrl,
    webPort,
    webHost,
    isCloudRun,
    cloudRunService,
    isCloud,
    shutdownTimeoutMs,
  };
}

/** 支持 AbortSignal 提前取消的异步休眠工具。 */
export function abortableSleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 轮询内部 API `/api/health` 直到返回 HTTP 200（门控 Web 服务启动）。
 * 若探测期间收到中止信号（例如 API 快速崩溃熔断或容器停机），立即停止等待。
 */
export async function waitForApiReady({
  healthUrl,
  timeoutMs = DEFAULT_API_READY_TIMEOUT_MS,
  requestTimeoutMs = DEFAULT_API_HEALTH_REQUEST_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_API_HEALTH_POLL_INTERVAL_MS,
  fetchImpl = fetch,
  signal,
  nowFn = Date.now,
  sleepFn = abortableSleep,
  onPollFailure,
}) {
  const deadline = nowFn() + timeoutMs;
  let attempts = 0;

  while (true) {
    if (signal?.aborted) {
      return { ok: false, reason: "aborted", attempts };
    }
    attempts += 1;
    let lastError = null;
    let statusCode = null;
    try {
      const reqSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)])
        : AbortSignal.timeout(requestTimeoutMs);
      const res = await fetchImpl(healthUrl, { signal: reqSignal });
      statusCode = res.status;
      if (res.ok) {
        return { ok: true, attempts, status: res.status };
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (signal?.aborted) {
        return { ok: false, reason: "aborted", attempts };
      }
      lastError = err;
    }

    const remaining = deadline - nowFn();
    if (remaining <= 0) {
      return {
        ok: false,
        reason: "timeout",
        attempts,
        lastStatus: statusCode,
        lastError: lastError instanceof Error ? lastError.message : String(lastError),
      };
    }

    onPollFailure?.({ attempts, statusCode, error: lastError });
    const interval = attempts <= 10 ? pollIntervalMs : Math.min(pollIntervalMs * 2, 1000);
    await sleepFn(Math.min(interval, remaining), signal);
  }
}

/**
 * 创建子进程退避重启与熔断状态机：
 * - 连续快速失败（< fastFailMs）达到 maxConsecutiveFastFails 次即熔断
 * - 滑动窗口（windowMs）内累计重启达到 maxRestartsInWindow 次即熔断
 */
export function createRestartTracker({
  maxRestartsInWindow = 5,
  windowMs = 10 * 60 * 1000,
  fastFailMs = 15_000,
  maxConsecutiveFastFails = 3,
  baseDelayMs = 2000,
  maxDelayMs = 30_000,
  randomFn = Math.random,
} = {}) {
  let consecutiveFastFails = 0;
  let restartTimestamps = [];

  return {
    resetStability() {
      consecutiveFastFails = 0;
    },
    recordExit({ uptimeMs, now = Date.now() }) {
      if (uptimeMs < fastFailMs) {
        consecutiveFastFails += 1;
      } else {
        consecutiveFastFails = 0;
      }

      restartTimestamps = restartTimestamps.filter((ts) => now - ts < windowMs);

      if (consecutiveFastFails >= maxConsecutiveFastFails) {
        return {
          action: "trip",
          reason: `consecutive_fast_fails (${consecutiveFastFails}/${maxConsecutiveFastFails})`,
          consecutiveFastFails,
          restartsInWindow: restartTimestamps.length,
        };
      }

      if (restartTimestamps.length >= maxRestartsInWindow) {
        return {
          action: "trip",
          reason: `max_restarts_in_window (${restartTimestamps.length}/${maxRestartsInWindow})`,
          consecutiveFastFails,
          restartsInWindow: restartTimestamps.length,
        };
      }

      restartTimestamps.push(now);
      const exponent = Math.min(Math.max(consecutiveFastFails - 1, 0), 4);
      const base = Math.min(baseDelayMs * 2 ** exponent, maxDelayMs);
      const jitter = Math.round(base * 0.2 * (randomFn() * 2 - 1));
      const delayMs = Math.max(250, base + jitter);

      return {
        action: "restart",
        delayMs,
        consecutiveFastFails,
        restartsInWindow: restartTimestamps.length,
      };
    },
    getState() {
      return {
        consecutiveFastFails,
        restartsInWindow: restartTimestamps.length,
      };
    },
  };
}

/**
 * 创建带防重入锁、超时强杀与生命周期追踪的 AutoCurator 执行器。
 */
export function createAutoCuratorRunner({
  rootDir,
  envArgs = [],
  env = process.env,
  spawnFn = spawn,
  timeoutMs = DEFAULT_CURATOR_TIMEOUT_MS,
  forceKillDelayMs = DEFAULT_CURATOR_FORCE_KILL_DELAY_MS,
  isShuttingDown = () => false,
  logger = console,
}) {
  let isCurating = false;
  let curatorProcess = null;
  let timeoutTimer = null;
  let forceKillTimer = null;

  function clearTimers() {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
    if (forceKillTimer) {
      clearTimeout(forceKillTimer);
      forceKillTimer = null;
    }
  }

  function run() {
    if (isShuttingDown()) {
      return { started: false, reason: "shutting_down" };
    }
    if (isCurating) {
      logger.warn("⏭️ [AutoCurator] Previous cycle still running, skipping overlapping trigger.");
      return { started: false, reason: "already_running" };
    }

    isCurating = true;
    logger.log("⏰ [AutoCurator] Starting autonomous news fetch and curation cycle...");

    const child = spawnFn("node", [...envArgs, "scripts/inject_premium_sources.mjs"], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...env },
    });
    curatorProcess = child;

    let settled = false;
    const finish = (label) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (curatorProcess === child) {
        curatorProcess = null;
      }
      isCurating = false;
      logger.log(`[AutoCurator] ${label}`);
    };

    child.stdout?.on("data", (d) => {
      const text = d.toString().trim();
      if (text) logger.log(`[AutoCurator] ${text}`);
    });
    child.stderr?.on("data", (d) => {
      process.stderr.write(`[AutoCurator ERR] ${d}`);
    });
    child.on("error", (err) => {
      finish(`Process error: ${err instanceof Error ? err.message : String(err)}`);
    });
    child.on("exit", (code, signal) => {
      finish(`Finished cycle with exit code ${code ?? "null"}${signal ? ` (signal ${signal})` : ""}`);
    });

    timeoutTimer = setTimeout(() => {
      if (settled || curatorProcess !== child) return;
      logger.error(`⏱️ [AutoCurator] Exceeded timeout (${timeoutMs}ms), sending SIGTERM...`);
      try {
        child.kill("SIGTERM");
      } catch {}
      forceKillTimer = setTimeout(() => {
        if (settled || curatorProcess !== child) return;
        logger.error("💀 [AutoCurator] Did not exit after SIGTERM, sending SIGKILL...");
        try {
          child.kill("SIGKILL");
        } catch {}
      }, forceKillDelayMs);
    }, timeoutMs);

    return { started: true, child };
  }

  return {
    run,
    getState() {
      return { isCurating, curatorProcess };
    },
    stop() {
      clearTimers();
      const child = curatorProcess;
      if (!child) return Promise.resolve();
      return waitForChildExit(child, "AutoCurator", forceKillDelayMs, logger);
    },
  };
}

/** 向子进程发送 SIGTERM 并等待其退出，超时后强制 SIGKILL。 */
export function waitForChildExit(child, name, timeoutMs, logger = console) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let done = false;
    let killTimer = null;

    const finish = () => {
      if (done) return;
      done = true;
      if (killTimer) clearTimeout(killTimer);
      resolve();
    };

    child.once("exit", finish);
    child.once("error", finish);

    try {
      child.kill("SIGTERM");
    } catch {
      finish();
      return;
    }

    killTimer = setTimeout(() => {
      if (done) return;
      logger.warn(`⚠️ [${name}] Graceful stop timed out after ${timeoutMs}ms, sending SIGKILL.`);
      try {
        child.kill("SIGKILL");
      } catch {}
      setTimeout(finish, 500);
    }, timeoutMs);
  });
}

/** 创建带退避重启与熔断机制的常驻子进程管理器。 */
export function createSupervisedService({
  name,
  command = "node",
  args,
  cwd,
  env,
  spawnFn = spawn,
  tracker = createRestartTracker(),
  stableMs = 60_000,
  isShuttingDown = () => false,
  onStdoutLine,
  onStderrData,
  onCircuitBreak,
  logger = console,
}) {
  let child = null;
  let startedAt = 0;
  let stableTimer = null;
  let restartTimer = null;

  function clearTimers() {
    if (stableTimer) {
      clearTimeout(stableTimer);
      stableTimer = null;
    }
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  }

  function start() {
    if (isShuttingDown()) return null;
    clearTimers();
    startedAt = Date.now();

    const proc = spawnFn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: typeof env === "function" ? env() : { ...env },
    });
    child = proc;

    stableTimer = setTimeout(() => {
      if (child === proc && proc.exitCode === null) {
        tracker.resetStability();
      }
    }, stableMs);

    let settled = false;
    const handleExit = (reasonLabel) => {
      if (settled) return;
      settled = true;
      if (stableTimer) {
        clearTimeout(stableTimer);
        stableTimer = null;
      }
      if (child === proc) {
        child = null;
      }
      if (isShuttingDown()) return;

      const uptimeMs = Date.now() - startedAt;
      const decision = tracker.recordExit({ uptimeMs });
      if (decision.action === "trip") {
        logger.error(
          `🔥 [${name}] Exited (${reasonLabel}) after ${uptimeMs}ms — circuit breaker tripped (${decision.reason}).`
        );
        onCircuitBreak?.(decision);
        return;
      }

      logger.warn(
        `♻️ [${name}] Exited (${reasonLabel}) after ${uptimeMs}ms — restarting in ${decision.delayMs}ms (window restarts: ${decision.restartsInWindow}).`
      );
      restartTimer = setTimeout(() => {
        restartTimer = null;
        start();
      }, decision.delayMs);
    };

    proc.stdout?.on("data", (d) => {
      const text = d.toString();
      if (onStdoutLine) {
        onStdoutLine(text);
      } else {
        const trimmed = text.trim();
        if (trimmed) logger.log(`[${name}] ${trimmed}`);
      }
    });

    proc.stderr?.on("data", (d) => {
      if (onStderrData) {
        onStderrData(d);
      } else {
        process.stderr.write(`[${name}] ${d}`);
      }
    });

    proc.on("error", (err) => {
      handleExit(`error: ${err instanceof Error ? err.message : String(err)}`);
    });
    proc.on("exit", (code, signal) => {
      handleExit(`code=${code ?? "null"}${signal ? `, signal=${signal}` : ""}`);
    });

    return proc;
  }

  return {
    start,
    cancelPendingRestart() {
      clearTimers();
    },
    getProcess() {
      return child;
    },
    stop(timeoutMs) {
      clearTimers();
      return waitForChildExit(child, name, timeoutMs, logger);
    },
  };
}

async function main() {
  const root = process.cwd();
  console.log("🚀 Starting AIHOT services...");

  const hasDotEnv = loadDotEnvIfExists(root, process.env);
  const envArgs = hasDotEnv ? ["--env-file=.env"] : [];

  try {
    validateRuntimeEnv(process.env);
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const runtimeCfg = resolveRuntimeConfig(process.env);
  let shuttingDown = false;
  let shutdownPromise = null;
  let curatorBootTimer = null;
  let curatorInterval = null;
  const readinessAbort = new AbortController();

  let apiService = null;
  let workerService = null;
  let webService = null;
  let curatorRunner = null;

  async function shutdown(exitCode = 0) {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    readinessAbort.abort();

    if (curatorBootTimer) {
      clearTimeout(curatorBootTimer);
      curatorBootTimer = null;
    }
    if (curatorInterval) {
      clearInterval(curatorInterval);
      curatorInterval = null;
    }

    apiService?.cancelPendingRestart();
    workerService?.cancelPendingRestart();
    webService?.cancelPendingRestart();

    console.log(`🛑 Shutting down services (exitCode=${exitCode})...`);

    shutdownPromise = (async () => {
      const hardDeadline = setTimeout(() => {
        console.error(`⏰ Forced exit after ${runtimeCfg.shutdownTimeoutMs}ms shutdown timeout.`);
        process.exit(exitCode || 1);
      }, runtimeCfg.shutdownTimeoutMs);
      hardDeadline.unref?.();

      try {
        // 1. 先排空并关闭对外 Web SSR 服务
        if (webService) {
          await webService.stop(DEFAULT_WEB_STOP_TIMEOUT_MS);
        }
        // 2. 再并行停止 AutoCurator、API 与 Worker（Worker 预留 STOP_TIMEOUT_MS=195s 收尾）
        const workerTimeoutMs = Math.max(10_000, runtimeCfg.shutdownTimeoutMs - DEFAULT_WEB_STOP_TIMEOUT_MS);
        await Promise.all([
          curatorRunner ? curatorRunner.stop() : Promise.resolve(),
          apiService ? apiService.stop(DEFAULT_API_STOP_TIMEOUT_MS) : Promise.resolve(),
          workerService ? workerService.stop(workerTimeoutMs) : Promise.resolve(),
        ]);
      } finally {
        clearTimeout(hardDeadline);
      }
      process.exit(exitCode);
    })();

    return shutdownPromise;
  }

  process.on("SIGINT", () => {
    void shutdown(0);
  });
  process.on("SIGTERM", () => {
    void shutdown(0);
  });

  // 1. 启动内部 API 服务
  apiService = createSupervisedService({
    name: "API",
    args: [...envArgs, "apps/api/src/main.ts"],
    cwd: root,
    env: () => ({
      ...process.env,
      API_PORT: runtimeCfg.apiPort,
      API_HOST: runtimeCfg.apiHost,
    }),
    isShuttingDown: () => shuttingDown,
    onStdoutLine: (text) => {
      if (text.includes("Server listening")) {
        console.log(`✅ API Service listening on http://${runtimeCfg.apiHost}:${runtimeCfg.apiPort}`);
      }
    },
    onCircuitBreak: () => {
      readinessAbort.abort();
      void shutdown(1);
    },
  });
  apiService.start();

  // 2. 并发启动 Worker（独立指数退避重试连库，受守护熔断保护）
  workerService = createSupervisedService({
    name: "Worker",
    args: [...envArgs, "apps/worker/src/main.ts"],
    cwd: root,
    env: () => ({ ...process.env }),
    isShuttingDown: () => shuttingDown,
    onCircuitBreak: () => {
      readinessAbort.abort();
      void shutdown(1);
    },
  });
  workerService.start();

  // 3. 启动门控：轮询内部 API /api/health 返回 200 后才放行 Web SSR 监听公网端口
  console.log(`⏳ Waiting for API readiness at ${runtimeCfg.apiHealthUrl}...`);
  const readiness = await waitForApiReady({
    healthUrl: runtimeCfg.apiHealthUrl,
    timeoutMs: DEFAULT_API_READY_TIMEOUT_MS,
    requestTimeoutMs: DEFAULT_API_HEALTH_REQUEST_TIMEOUT_MS,
    pollIntervalMs: DEFAULT_API_HEALTH_POLL_INTERVAL_MS,
    signal: readinessAbort.signal,
  });

  if (!readiness.ok) {
    if (!shuttingDown) {
      console.error(
        `❌ API failed readiness gate (${readiness.reason}, attempts=${readiness.attempts}, lastStatus=${readiness.lastStatus ?? "none"}, error=${readiness.lastError ?? "none"}).`
      );
      await shutdown(1);
    }
    return;
  }

  console.log(`✅ API readiness gate passed in ${readiness.attempts} probe(s).`);

  // 4. 启动 Web SSR 服务（仅在 API 与 DB 就绪后监听 PORT）
  const modeLabel = runtimeCfg.isCloudRun
    ? `Cloud Run: ${runtimeCfg.cloudRunService}`
    : runtimeCfg.isCloud
      ? "cloud"
      : "local";

  webService = createSupervisedService({
    name: "Web",
    args: [...envArgs, "apps/web/server.ts"],
    cwd: root,
    env: () => ({
      ...process.env,
      PORT: runtimeCfg.webPort,
      WEB_PORT: runtimeCfg.webPort,
      WEB_HOST: runtimeCfg.webHost,
      API_BASE_URL: runtimeCfg.apiBaseUrl,
    }),
    isShuttingDown: () => shuttingDown,
    onStdoutLine: (text) => {
      if (text.includes("web started")) {
        console.log(`✅ Web Frontend listening on http://${runtimeCfg.webHost}:${runtimeCfg.webPort} (${modeLabel})`);
      }
    },
    onCircuitBreak: () => {
      void shutdown(1);
    },
  });
  webService.start();

  // 5. 启动 AutoCurator 定时巡检（防重入 + 12 分钟超时强杀）
  curatorRunner = createAutoCuratorRunner({
    rootDir: root,
    envArgs,
    env: process.env,
    isShuttingDown: () => shuttingDown,
  });
  curatorBootTimer = setTimeout(() => curatorRunner.run(), DEFAULT_CURATOR_BOOT_DELAY_MS);
  curatorInterval = setInterval(() => curatorRunner.run(), DEFAULT_CURATOR_INTERVAL_MS);
}

const isMain =
  Boolean(process.argv[1]) &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((err) => {
    console.error("FATAL runtime launcher error:", err);
    process.exit(1);
  });
}
