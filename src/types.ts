export type InvestmentAction = '观望' | '轻仓试探' | '分批布局' | '持有等待' | '降低仓位' | '偏防守';

export interface Env {
  RUNTIME_KV: KVNamespace;
  AI?: Ai;
  FEISHU_WEBHOOK?: string;
  FEISHU_SECRET?: string;
  MANUAL_TRIGGER_TOKEN?: string;
  TENCENT_COS_SECRET_ID?: string;
  TENCENT_COS_SECRET_KEY?: string;
  TENCENT_COS_BUCKET?: string;
  TENCENT_COS_REGION?: string;
  TENCENT_COS_BASE_URL?: string;
  WORKER_PUBLIC_BASE_URL?: string;
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  RUN_HOUR_LOCAL?: string;
  RUN_MINUTE_LOCAL?: string;
  RUN_WEEKDAYS?: string;
  MARKET_TIMEZONE?: string;
  REQUEST_TIMEOUT_MS?: string;
  HEARTBEAT_ENABLED?: string;
  HEARTBEAT_INTERVAL_HOURS?: string;
  FAILURE_ALERT_THRESHOLD?: string;
  FAILURE_ALERT_COOLDOWN_MINUTES?: string;
  LOOKBACK_DAYS?: string;
  LLM_MODEL?: string;
  SOURCE_PREFIXES?: string;
  MAX_REPORTS_PER_SOURCE?: string;
  MAX_REPORT_CHARS?: string;
  MAX_SOURCE_CHARS?: string;
  MAX_TOTAL_CHARS?: string;
}

export interface AppConfig {
  feishuWebhook: string;
  feishuSecret: string;
  manualTriggerToken: string;
  cosSecretId: string;
  cosSecretKey: string;
  cosBucket: string;
  cosRegion: string;
  cosBaseUrl: string;
  workerPublicBaseUrl: string;
  llmBaseUrl: string;
  llmApiKey: string;
  runHourLocal: number;
  runMinuteLocal: number;
  runWeekdays: number[];
  marketTimezone: string;
  requestTimeoutMs: number;
  heartbeatEnabled: boolean;
  heartbeatIntervalHours: number;
  failureAlertThreshold: number;
  failureAlertCooldownMinutes: number;
  lookbackDays: number;
  llmModel: string;
  sourcePrefixes: string[];
  maxReportsPerSource: number;
  maxReportChars: number;
  maxSourceChars: number;
  maxTotalChars: number;
  feishuConfigured: boolean;
  cosConfigured: boolean;
}

export interface CosObjectSummary {
  key: string;
  lastModified?: string;
  size?: number;
}

export interface SourceReport {
  sourcePrefix: string;
  key: string;
  generatedAt: string;
  publicUrl: string;
  rawContent: string;
  extractedText: string;
  excerpt: string;
}

export interface SourceReportGroup {
  sourcePrefix: string;
  reports: SourceReport[];
  combinedText: string;
}

export interface AggregatedContext {
  groups: SourceReportGroup[];
  llmInput: string;
  totalReports: number;
  usedSources: string[];
  missingSources: string[];
  droppedReportKeys: string[];
}

export interface MarketConclusion {
  marketView: string;
  action: InvestmentAction;
  actionRationale: string;
  keyDrivers: string[];
  riskWarnings: string[];
  confidence: 'high' | 'medium' | 'low';
  modelLabel: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  llmBackend?: 'proxy' | 'workers-ai' | 'fallback';
  upstreamError?: string;
}

export interface LastRunRecord {
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'succeeded' | 'failed';
  trigger: 'manual' | 'scheduled';
  tradeDate?: string;
  reportUrl?: string;
  action?: InvestmentAction;
  modelLabel?: string;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  llmBackend?: 'proxy' | 'workers-ai' | 'fallback';
  upstreamError?: string;
  messagePreview?: string;
  usedSources?: string[];
  missingSources?: string[];
  error?: string;
}

export interface RuntimeState {
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  lastHeartbeatAt?: string;
  consecutiveFailures: number;
  lastAlertAt?: string;
}

export interface RunResult {
  tradeDate: string;
  reportUrl?: string;
  messagePreview: string;
  modelLabel: string;
  conclusion: MarketConclusion;
  context: AggregatedContext;
}
