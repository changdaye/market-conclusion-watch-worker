import { describe, expect, it } from 'vitest';
import { buildDailyMessage, buildFailureAlertMessage, buildHeartbeatMessage } from '../src/lib/message';
import type { MarketConclusion, RuntimeState } from '../src/types';

const conclusion: MarketConclusion = {
  marketView: '风险偏好有所修复，但仍需控制节奏。',
  action: '观望',
  actionRationale: '来源并未完全一致，先等待更多确认。',
  keyDrivers: ['情绪改善', '估值压力仍在'],
  riskWarnings: ['缺失一个来源'],
  confidence: 'medium',
  modelLabel: 'GPT 5.4 (xhigh)',
  fallbackUsed: false,
};

const state: RuntimeState = {
  consecutiveFailures: 2,
  lastSuccessAt: '2026-04-27T12:00:00.000Z',
};

describe('message builders', () => {
  it('keeps the preferred Feishu report footer', () => {
    const text = buildDailyMessage(conclusion, 'https://example.com/report.html', '已覆盖：jinshi\n缺失：reddit');
    expect(text).toContain('🤖 模型：GPT 5.4 (xhigh)');
    expect(text).toContain('【综合结论】');
    expect(text).toContain('【操作建议】');
    expect(text).toContain('【关注代码】');
    expect(text).toContain('详细版报告:\nhttps://example.com/report.html');
  });

  it('formats heartbeat and failure alerts', () => {
    expect(buildHeartbeatMessage(state, 24)).toContain('心跳间隔: 24h');
    expect(buildFailureAlertMessage({ ...state, consecutiveFailures: 4, lastError: 'boom' }, 3)).toContain('最近错误: boom');
  });
});
