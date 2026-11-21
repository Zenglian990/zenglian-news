import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import {
  createAutoCuratorRunner,
  createRestartTracker,
  createSupervisedService,
  resolveRuntimeConfig,
  validateRuntimeEnv,
  waitForApiReady,
} from "../run-all.mjs";
import { validateExportEnv } from "./export_fresh_data_from_db.mjs";
import {
  StartupAbortedError,
  computeBackoffDelayMs,
  isNonRetryableStartupError,
  retryStartupStep,
  sanitizeStartupErrorMessage,
} from "../apps/worker/src/startup.ts";

class FakeChildProcess extends EventEmitter {
  constructor(pid = 1001) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.signalCode = null;
    this.killedSignals = [];
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
  }

  kill(signal = "SIGTERM") {
    this.killedSignals.push(signal);
    return true;
  }

  simulateExit(code = 0, signal = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }
}

describe("run-all.mjs runtime environment validation", () => {
  it("fails fast when DATABASE_URL is missing", () => {
    assert.throws(
      () => validateRuntimeEnv({ NODE_ENV: "development" }),
      /DATABASE_URL/
    );
  });

  it("rejects localhost DATABASE_URL, weak secrets, and localhost SITE_URL in production", () => {
    assert.throws(
      () =>
        validateRuntimeEnv({
          NODE_ENV: "production",
          DATABASE_URL: "postgres://user:pass@127.0.0.1:5432/db",
          SESSION_SECRET: "changeme",
          IMG_PROXY_SIGN_SECRET: "short",
          SITE_URL: "http://localhost:3000",
          ADMIN_PASSWORD: "short",
        }),
      (err) => {
        assert.match(err.message, /DATABASE_URL must not point to localhost/);
        assert.match(err.message, /SESSION_SECRET/);
        assert.match(err.message, /IMG_PROXY_SIGN_SECRET/);
        assert.match(err.message, /SITE_URL must not point to localhost/);
        assert.match(err.message, /ADMIN_PASSWORD/);
        return true;
      }
    );
  });

  it("enforces production rules when K_SERVICE is set even without NODE_ENV=production", () => {
    assert.throws(
      () =>
        validateRuntimeEnv({
          K_SERVICE: "zenglian-news",
          DATABASE_URL: "postgresql://u:p@ep-example.neon.tech/neondb?sslmode=require",
        }),
      /SESSION_SECRET/
    );
  });

  it("allows omitting ADMIN_PASSWORD in production when Feishu login is configured", () => {
    assert.doesNotThrow(() =>
      validateRuntimeEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://u:realpass@ep-example.neon.tech/neondb?sslmode=require",
        SESSION_SECRET: "prod-session-secret-1234",
        IMG_PROXY_SIGN_SECRET: "prod-proxy-secret-1234",
        SITE_URL: "https://zenglian-news-79709693345.asia-east1.run.app",
        FEISHU_LOGIN_APP_ID: "cli_123456",
        FEISHU_LOGIN_APP_SECRET: "secret_123456",
      })
    );
  });

  it("passes valid production environment", () => {
    assert.doesNotThrow(() =>
      validateRuntimeEnv({
        NODE_ENV: "production",
        K_SERVICE: "zenglian-news",
        DATABASE_URL: "postgresql://u:realpass@ep-example.neon.tech/neondb?sslmode=require",
        SESSION_SECRET: "prod-session-secret-1234",
        IMG_PROXY_SIGN_SECRET: "prod-proxy-secret-1234",
        SITE_URL: "https://zenglian-news-79709693345.asia-east1.run.app",
        ADMIN_PASSWORD: "StrongAdminPassword!2026",
      })
    );
  });
});

describe("run-all.mjs runtime config & readiness gate", () => {
  it("resolves Cloud Run and local bindings accurately", () => {
    const cloudCfg = resolveRuntimeConfig({
      K_SERVICE: "zenglian-news",
      PORT: "8080",
      API_HOST: "0.0.0.0",
      API_PORT: "3001",
    });
    assert.equal(cloudCfg.isCloudRun, true);
    assert.equal(cloudCfg.cloudRunService, "zenglian-news");
    assert.equal(cloudCfg.webHost, "0.0.0.0");
    assert.equal(cloudCfg.webPort, "8080");
    assert.equal(cloudCfg.apiBaseUrl, "http://127.0.0.1:3001");

    const localCfg = resolveRuntimeConfig({});
    assert.equal(localCfg.isCloudRun, false);
    assert.equal(localCfg.webHost, "127.0.0.1");
    assert.equal(localCfg.webPort, "3000");
  });

  it("polls /api/health until HTTP 200 before allowing web startup", async () => {
    let calls = 0;
    const result = await waitForApiReady({
      healthUrl: "http://127.0.0.1:3001/api/health",
      timeoutMs: 5_000,
      pollIntervalMs: 10,
      sleepFn: async () => {},
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) throw new Error("ECONNREFUSED");
        if (calls === 2) return { ok: false, status: 503 };
        return { ok: true, status: 200 };
      },
    });
    assert.deepEqual(result, { ok: true, attempts: 3, status: 200 });
  });

  it("aborts readiness polling immediately when AbortSignal fires", async () => {
    const ac = new AbortController();
    let calls = 0;
    const result = await waitForApiReady({
      healthUrl: "http://127.0.0.1:3001/api/health",
      timeoutMs: 60_000,
      signal: ac.signal,
      sleepFn: async () => {},
      fetchImpl: async () => {
        calls += 1;
        ac.abort();
        return { ok: false, status: 503 };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "aborted");
  });

  it("returns timeout when API never becomes healthy within deadline", async () => {
    let now = 0;
    const result = await waitForApiReady({
      healthUrl: "http://127.0.0.1:3001/api/health",
      timeoutMs: 100,
      pollIntervalMs: 40,
      nowFn: () => now,
      sleepFn: async (ms) => {
        now += ms;
      },
      fetchImpl: async () => ({ ok: false, status: 503 }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "timeout");
    assert.equal(result.lastStatus, 503);
  });
});

describe("run-all.mjs restart supervisor & circuit breaker", () => {
  it("trips circuit breaker on 3 consecutive fast failures", () => {
    const tracker = createRestartTracker({ randomFn: () => 0.5 });
    const r1 = tracker.recordExit({ uptimeMs: 500, now: 1_000 });
    assert.equal(r1.action, "restart");
    assert.equal(r1.delayMs, 2000);

    const r2 = tracker.recordExit({ uptimeMs: 800, now: 4_000 });
    assert.equal(r2.action, "restart");
    assert.equal(r2.delayMs, 4000);

    const r3 = tracker.recordExit({ uptimeMs: 300, now: 9_000 });
    assert.equal(r3.action, "trip");
    assert.match(r3.reason, /consecutive_fast_fails/);
  });

  it("trips circuit breaker when restarts exceed 5 within 10-minute window", () => {
    const tracker = createRestartTracker({ randomFn: () => 0.5 });
    for (let i = 0; i < 5; i += 1) {
      const res = tracker.recordExit({ uptimeMs: 25_000, now: 10_000 + i * 30_000 });
      assert.equal(res.action, "restart");
    }
    const tripped = tracker.recordExit({ uptimeMs: 25_000, now: 160_000 });
    assert.equal(tripped.action, "trip");
    assert.match(tripped.reason, /max_restarts_in_window/);
  });

  it("supervises child process crashes and invokes onCircuitBreak", async () => {
    const children = [];
    let trippedDecision = null;
    const tracker = createRestartTracker({
      maxConsecutiveFastFails: 2,
      baseDelayMs: 10,
      randomFn: () => 0.5,
    });
    const noopLogger = { log() {}, warn() {}, error() {} };
    const svc = createSupervisedService({
      name: "API-Test",
      args: ["apps/api/src/main.ts"],
      cwd: process.cwd(),
      env: {},
      tracker,
      logger: noopLogger,
      spawnFn: () => {
        const proc = new FakeChildProcess(children.length + 1);
        children.push(proc);
        return proc;
      },
      onCircuitBreak: (decision) => {
        trippedDecision = decision;
      },
    });

    svc.start();
    assert.equal(children.length, 1);
    children[0].simulateExit(1);

    await new Promise((r) => setTimeout(r, 400));
    assert.equal(children.length, 2);
    children[1].simulateExit(1);

    assert.ok(trippedDecision);
    assert.equal(trippedDecision.action, "trip");
    svc.cancelPendingRestart();
  });
});

describe("run-all.mjs AutoCurator lock & timeout", () => {
  it("prevents overlapping curator runs and releases lock on exit", () => {
    const spawned = [];
    const noopLogger = { log() {}, warn() {}, error() {} };
    const runner = createAutoCuratorRunner({
      rootDir: process.cwd(),
      envArgs: ["--env-file=.env"],
      env: {},
      timeoutMs: 60_000,
      logger: noopLogger,
      spawnFn: (_cmd, args) => {
        const proc = new FakeChildProcess(500 + spawned.length);
        spawned.push({ args, proc });
        return proc;
      },
    });

    const first = runner.run();
    assert.equal(first.started, true);
    assert.deepEqual(spawned[0].args, ["--env-file=.env", "scripts/inject_premium_sources.mjs"]);
    assert.equal(runner.getState().isCurating, true);

    const overlapping = runner.run();
    assert.deepEqual(overlapping, { started: false, reason: "already_running" });
    assert.equal(spawned.length, 1);

    spawned[0].proc.simulateExit(0);
    assert.equal(runner.getState().isCurating, false);

    const second = runner.run();
    assert.equal(second.started, true);
    assert.equal(spawned.length, 2);
    spawned[1].proc.simulateExit(0);
  });

  it("sends SIGTERM then SIGKILL when curator exceeds timeout", async () => {
    let proc = null;
    const noopLogger = { log() {}, warn() {}, error() {} };
    const runner = createAutoCuratorRunner({
      rootDir: process.cwd(),
      env: {},
      timeoutMs: 25,
      forceKillDelayMs: 30,
      logger: noopLogger,
      spawnFn: () => {
        proc = new FakeChildProcess(777);
        return proc;
      },
    });

    runner.run();
    await new Promise((r) => setTimeout(r, 90));
    assert.deepEqual(proc.killedSignals, ["SIGTERM", "SIGKILL"]);
    proc.simulateExit(null, "SIGKILL");
  });
});

describe("apps/worker/src/startup.ts resilience", () => {
  it("classifies deterministic PG and config errors as non-retryable", () => {
    assert.equal(isNonRetryableStartupError(Object.assign(new Error("auth failed"), { code: "28P01" })), true);
    assert.equal(
      isNonRetryableStartupError(
        Object.assign(new Error("wrapped"), { cause: { code: "42P01" } })
      ),
      true
    );
    assert.equal(isNonRetryableStartupError(new Error("Refusing to start in production: IMG_PROXY_SIGN_SECRET")), true);
    assert.equal(isNonRetryableStartupError(Object.assign(new Error("write CONNECT_TIMEOUT"), { code: "CONNECT_TIMEOUT" })), false);
    assert.equal(isNonRetryableStartupError(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })), false);
  });

  it("computes bounded exponential backoff delays", () => {
    assert.equal(computeBackoffDelayMs(1, 2000, 30_000, () => 0.5), 2000);
    assert.equal(computeBackoffDelayMs(2, 2000, 30_000, () => 0.5), 4000);
    assert.equal(computeBackoffDelayMs(3, 2000, 30_000, () => 0.5), 8000);
    assert.equal(computeBackoffDelayMs(6, 2000, 30_000, () => 0.5), 30_000);
  });

  it("retries transient startup errors and succeeds", async () => {
    let attempts = 0;
    const delays = [];
    const logs = [];
    const result = await retryStartupStep(
      "ensureContentTargets",
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw Object.assign(new Error("write CONNECT_TIMEOUT"), { code: "CONNECT_TIMEOUT" });
        }
        return "ready";
      },
      {
        maxAttempts: 6,
        baseDelayMs: 1000,
        randomFn: () => 0.5,
        sleepFn: async (ms) => {
          delays.push(ms);
          return true;
        },
        log: (line) => logs.push(line),
      }
    );
    assert.equal(result, "ready");
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [1000, 2000]);
    assert.equal(logs.length, 2);
  });

  it("fails fast on non-retryable errors without sleeping", async () => {
    let attempts = 0;
    let slept = false;
    await assert.rejects(
      () =>
        retryStartupStep(
          "getBoss",
          async () => {
            attempts += 1;
            throw Object.assign(new Error("password authentication failed"), { code: "28P01" });
          },
          {
            maxAttempts: 6,
            sleepFn: async () => {
              slept = true;
              return true;
            },
            log: () => {},
          }
        ),
      /password authentication failed/
    );
    assert.equal(attempts, 1);
    assert.equal(slept, false);
  });

  it("aborts immediately during retry sleep when AbortSignal fires", async () => {
    const ac = new AbortController();
    await assert.rejects(
      () =>
        retryStartupStep(
          "getBoss",
          async () => {
            throw Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" });
          },
          {
            signal: ac.signal,
            baseDelayMs: 10_000,
            sleepFn: async () => {
              ac.abort();
              return false;
            },
            log: () => {},
          }
        ),
      StartupAbortedError
    );
  });

  it("sanitizes PostgreSQL credentials from error messages", () => {
    const msg = sanitizeStartupErrorMessage(
      new Error("connect failed for postgresql://neondb_owner:super_secret_pw@ep-1.neon.tech/neondb")
    );
    assert.equal(msg.includes("super_secret_pw"), false);
    assert.match(msg, /postgresql:\/\/neondb_owner:\*\*\*@ep-1\.neon\.tech/);
  });
});

describe("scripts/export_fresh_data_from_db.mjs environment validation", () => {
  it("fails fast when DATABASE_URL or SITE_URL is missing or invalid", () => {
    assert.throws(() => validateExportEnv({}), /Missing required DATABASE_URL/);
    assert.throws(
      () => validateExportEnv({ DATABASE_URL: "postgres://u:p@host/db" }),
      /Missing required SITE_URL/
    );
    assert.throws(
      () => validateExportEnv({ DATABASE_URL: "postgres://u:p@host/db", SITE_URL: "ftp://bad.example.com" }),
      /SITE_URL must use http: or https:/
    );
  });

  it("normalizes trailing slashes from valid SITE_URL", () => {
    const cfg = validateExportEnv({
      DATABASE_URL: "postgres://u:p@host/db",
      SITE_URL: "https://zenglian-news-79709693345.asia-east1.run.app/",
    });
    assert.equal(cfg.siteUrl, "https://zenglian-news-79709693345.asia-east1.run.app");
    assert.equal(cfg.deepseekKey, "");
  });
});
