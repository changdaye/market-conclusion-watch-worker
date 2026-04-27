import type { AppConfig, Env } from './types';
import { toBoolean, toInt } from './lib/value';

const DEFAULT_SOURCE_PREFIXES = [
  'a-share-margin-sentiment-worker',
  'jinshi-market-brief-worker',
  'portfolio-valuation-watch-worker',
  'reddit-stocks-digest-worker',
  'taoguba-hot-topics-worker',
  'trump-truth-social-digest-worker',
];

function toWeekdays(raw: string | undefined): number[] {
  const parsed = (raw ?? '0,1,2,3,4,5,6')
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
  return parsed.length ? parsed : [0, 1, 2, 3, 4, 5, 6];
}

function toPrefixes(raw: string | undefined): string[] {
  const parsed = (raw ?? DEFAULT_SOURCE_PREFIXES.join(','))
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parsed.length ? parsed : DEFAULT_SOURCE_PREFIXES;
}

export function parseConfig(env: Partial<Env>): AppConfig {
  const bucket = env.TENCENT_COS_BUCKET?.trim() || 'cloudflare-static-1252612849';
  const region = env.TENCENT_COS_REGION?.trim() || 'ap-shanghai';
  const cosConfigured = Boolean(env.TENCENT_COS_SECRET_ID?.trim() && env.TENCENT_COS_SECRET_KEY?.trim() && bucket && region);
  return {
    feishuWebhook: env.FEISHU_WEBHOOK?.trim() ?? '',
    feishuSecret: env.FEISHU_SECRET?.trim() ?? '',
    manualTriggerToken: env.MANUAL_TRIGGER_TOKEN?.trim() ?? '',
    cosSecretId: env.TENCENT_COS_SECRET_ID?.trim() ?? '',
    cosSecretKey: env.TENCENT_COS_SECRET_KEY?.trim() ?? '',
    cosBucket: bucket,
    cosRegion: region,
    cosBaseUrl: env.TENCENT_COS_BASE_URL?.trim() || (bucket && region ? `https://${bucket}.cos.${region}.myqcloud.com` : ''),
    workerPublicBaseUrl: env.WORKER_PUBLIC_BASE_URL?.trim() || 'https://market-conclusion-watch-worker.wanggejiancai822.workers.dev',
    llmBaseUrl: env.LLM_BASE_URL?.trim() ?? '',
    llmApiKey: env.LLM_API_KEY?.trim() ?? '',
    runHourLocal: toInt(env.RUN_HOUR_LOCAL, 5, 0),
    runMinuteLocal: toInt(env.RUN_MINUTE_LOCAL, 0, 0),
    runWeekdays: toWeekdays(env.RUN_WEEKDAYS),
    marketTimezone: env.MARKET_TIMEZONE?.trim() || 'Asia/Shanghai',
    requestTimeoutMs: toInt(env.REQUEST_TIMEOUT_MS, 20000, 1000),
    heartbeatEnabled: toBoolean(env.HEARTBEAT_ENABLED, true),
    heartbeatIntervalHours: toInt(env.HEARTBEAT_INTERVAL_HOURS, 24, 1),
    failureAlertThreshold: toInt(env.FAILURE_ALERT_THRESHOLD, 3, 1),
    failureAlertCooldownMinutes: toInt(env.FAILURE_ALERT_COOLDOWN_MINUTES, 360, 1),
    lookbackDays: toInt(env.LOOKBACK_DAYS, 3, 1),
    llmModel: env.LLM_MODEL?.trim() || '@cf/meta/llama-3.1-8b-instruct',
    sourcePrefixes: toPrefixes(env.SOURCE_PREFIXES),
    maxReportsPerSource: toInt(env.MAX_REPORTS_PER_SOURCE, 1, 1),
    maxReportChars: toInt(env.MAX_REPORT_CHARS, 6000, 500),
    maxSourceChars: toInt(env.MAX_SOURCE_CHARS, 12000, 1000),
    maxTotalChars: toInt(env.MAX_TOTAL_CHARS, 48000, 2000),
    feishuConfigured: Boolean(env.FEISHU_WEBHOOK?.trim() && env.FEISHU_SECRET?.trim()),
    cosConfigured,
  };
}

export function assertRuntimeEnv(env: Partial<Env>, config: AppConfig): void {
  if (!env.RUNTIME_KV) throw new Error('missing RUNTIME_KV binding');
  if (!config.feishuConfigured) throw new Error('missing FEISHU_WEBHOOK or FEISHU_SECRET');
  if (!config.cosConfigured) throw new Error('missing Tencent COS configuration');
}
