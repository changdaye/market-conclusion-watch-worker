import { describe, expect, it, vi } from 'vitest';
import { summarizeWithLLM } from '../src/services/llm';
import type { AggregatedContext, AppConfig } from '../src/types';

function makeConfig(): AppConfig {
  return {
    feishuWebhook: 'https://example.com/hook',
    feishuSecret: 'secret',
    manualTriggerToken: 'token',
    cosSecretId: 'secret-id',
    cosSecretKey: 'secret-key',
    cosBucket: 'cloudflare-static-1252612849',
    cosRegion: 'ap-shanghai',
    cosBaseUrl: 'https://bucket.cos.ap-shanghai.myqcloud.com',
    workerPublicBaseUrl: 'https://example.workers.dev',
    llmBaseUrl: '',
    llmApiKey: '',
    runHourLocal: 23,
    runMinuteLocal: 45,
    runWeekdays: [0, 1, 2, 3, 4, 5, 6],
    marketTimezone: 'Asia/Shanghai',
    requestTimeoutMs: 20000,
    heartbeatEnabled: true,
    heartbeatIntervalHours: 24,
    failureAlertThreshold: 3,
    failureAlertCooldownMinutes: 360,
    lookbackDays: 3,
    llmModel: 'gpt-5.4',
    sourcePrefixes: ['jinshi-market-brief-worker'],
    maxReportsPerSource: 1,
    maxReportChars: 6000,
    maxSourceChars: 12000,
    maxTotalChars: 48000,
    feishuConfigured: true,
    cosConfigured: true,
  };
}

const context: AggregatedContext = {
  groups: [],
  llmInput: '# 来源: jinshi-market-brief-worker\n市场风险偏好回暖。',
  totalReports: 2,
  usedSources: ['jinshi-market-brief-worker'],
  missingSources: ['portfolio-valuation-watch-worker'],
  droppedReportKeys: [],
};

describe('summarizeWithLLM', () => {
  it('prefers the OpenAI-compatible proxy when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"marketView":"风险偏好修复，但仍需控制节奏。","action":"观望","actionRationale":"虽然情绪改善，但来源覆盖仍不完整。","keyDrivers":["情绪改善","估值压力仍在"],"riskWarnings":["缺失部分来源"],"confidence":"medium"}' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await summarizeWithLLM(
      { ...makeConfig(), llmBaseUrl: 'https://proxy.example.com/v1', llmApiKey: 'proxy-key', llmModel: 'gpt-5.4' },
      { run: vi.fn() } as unknown as Ai,
      context,
    );

    expect(result.action).toBe('观望');
    expect(result.modelLabel).toBe('GPT 5.4 (xhigh)');
    expect(result.fallbackUsed).toBe(false);
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.model).toBe('gpt-5.4');
    expect(body.reasoning_effort).toBe('xhigh');
  });

  it('falls back to Workers AI when the proxy fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 })));
    const run = vi.fn().mockResolvedValue({ response: '{"marketView":"短期波动仍大。","action":"偏防守","actionRationale":"缺失来源较多。","keyDrivers":["波动较大"],"riskWarnings":["缺失来源"],"confidence":"low"}' });

    const result = await summarizeWithLLM(
      { ...makeConfig(), llmBaseUrl: 'https://proxy.example.com/v1', llmApiKey: 'proxy-key', llmModel: 'gpt-5.4' },
      { run } as unknown as Ai,
      context,
    );

    expect(result.action).toBe('偏防守');
    expect(result.modelLabel).toBe('Llama 3.2 1B Instruct');
    expect(result.fallbackUsed).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
