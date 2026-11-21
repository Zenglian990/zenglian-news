// Worker 启动阶段纯逻辑辅助模块：不可恢复错误判定、脱敏日志、有界指数退避重试。
// 注意：本模块不读取任何 process.env，避免引入未在 .env.example 声明的环境变量。

export const DEFAULT_WORKER_MAX_STARTUP_ATTEMPTS = 6;
export const DEFAULT_WORKER_BASE_DELAY_MS = 2_000;
export const DEFAULT_WORKER_MAX_DELAY_MS = 30_000;

const NON_RETRYABLE_PG_CODES = new Set([
  "28P01", // invalid_password
  "28000", // invalid_authorization_specification
  "3D000", // invalid_catalog_name (database does not exist)
  "42P01", // undefined_table (migrations not applied)
  "22P02", // invalid_text_representation
]);

const NON_RETRYABLE_NODE_CODES = new Set([
  "ERR_INVALID_URL",
]);

const NON_RETRYABLE_MESSAGE_PATTERNS = [
  /Refusing to start in production/i,
  /Missing required environment variable/i,
  /Environment variable .+ must be an integer/i,
  /Invalid URL/i,
];

/** 脱敏错误信息，避免在日志中暴露数据库连接串密码或冗长堆栈。 */
export function sanitizeStartupErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "Unknown error");
  return raw
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+(@)/gi, "$1***$2")
    .slice(0, 400);
}

/** 提取错误对象或其 cause 中的错误码。 */
export function extractErrorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const record = err as { code?: unknown; cause?: unknown };
  if (typeof record.code === "string" && record.code.length > 0) {
    return record.code;
  }
  if (record.cause && typeof record.cause === "object") {
    const causeRecord = record.cause as { code?: unknown };
    if (typeof causeRecord.code === "string" && causeRecord.code.length > 0) {
      return causeRecord.code;
    }
  }
  return null;
}

/** 判断启动错误是否为确定性配置/认证/架构错误（不可通过重试恢复，应立即 Fail-Fast）。 */
export function isNonRetryableStartupError(err: unknown): boolean {
  const code = extractErrorCode(err);
  if (code && (NON_RETRYABLE_PG_CODES.has(code) || NON_RETRYABLE_NODE_CODES.has(code))) {
    return true;
  }
  const message = err instanceof Error ? err.message : String(err ?? "");
  return NON_RETRYABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

/** 计算带 ±20% 抖动的有界指数退避延迟（毫秒）。 */
export function computeBackoffDelayMs(
  attempt: number,
  baseDelayMs = DEFAULT_WORKER_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_WORKER_MAX_DELAY_MS,
  randomFn: () => number = Math.random
): number {
  const exp = Math.max(0, attempt - 1);
  const raw = Math.min(baseDelayMs * 2 ** exp, maxDelayMs);
  const jitter = Math.round(raw * 0.2 * (randomFn() * 2 - 1));
  return Math.max(200, raw + jitter);
}

/** 支持 AbortSignal 中止的异步休眠。 */
export function abortableWorkerSleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  if (ms <= 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class StartupAbortedError extends Error {
  constructor(step: string) {
    super(`Worker startup aborted during ${step}`);
    this.name = "StartupAbortedError";
  }
}

export interface RetryStartupOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  sleepFn?: (ms: number, signal?: AbortSignal) => Promise<boolean>;
  randomFn?: () => number;
  log?: (line: string) => void;
}

/** 对 Worker 启动期依赖数据库连接的可恢复步骤执行有界指数退避重试。 */
export async function retryStartupStep<T>(
  stepName: string,
  fn: () => Promise<T>,
  options: RetryStartupOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_WORKER_MAX_STARTUP_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_WORKER_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_WORKER_MAX_DELAY_MS;
  const signal = options.signal;
  const sleepFn = options.sleepFn ?? abortableWorkerSleep;
  const randomFn = options.randomFn ?? Math.random;
  const log = options.log ?? ((line: string) => console.warn(line));

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      throw new StartupAbortedError(stepName);
    }
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (signal?.aborted) {
        throw new StartupAbortedError(stepName);
      }
      if (isNonRetryableStartupError(err) || attempt >= maxAttempts) {
        throw err;
      }
      const delayMs = computeBackoffDelayMs(attempt, baseDelayMs, maxDelayMs, randomFn);
      const code = extractErrorCode(err);
      log(
        JSON.stringify({
          level: "warn",
          msg: "worker startup step failed, retrying with backoff",
          step: stepName,
          attempt,
          maxAttempts,
          delayMs,
          code,
          error: sanitizeStartupErrorMessage(err),
        })
      );
      const completed = await sleepFn(delayMs, signal);
      if (!completed || signal?.aborted) {
        throw new StartupAbortedError(stepName);
      }
    }
  }

  throw lastError;
}
