import { describe, expect, it } from 'vitest';
import { buildDetailedReport } from '../src/lib/report';
import type { AggregatedContext, MarketConclusion } from '../src/types';

const conclusion: MarketConclusion = {
  marketView: '市场分化延续，短期宜审慎。',
  action: '观望',
  actionRationale: '来源存在分歧，先等待更强一致性。',
  keyDrivers: ['来源一偏积极', '来源二偏谨慎'],
  riskWarnings: ['缺失部分来源'],
  confidence: 'medium',
  modelLabel: 'GPT 5.4 (xhigh)',
  fallbackUsed: false,
};

const context: AggregatedContext = {
  groups: [{
    sourcePrefix: 'jinshi-market-brief-worker',
    combinedText: '摘要',
    reports: [{
      sourcePrefix: 'jinshi-market-brief-worker',
      key: 'jinshi-market-brief-worker/20260427101010.html',
      generatedAt: '2026-04-27T10:10:10Z',
      publicUrl: 'https://example.com/jinshi-market-brief-worker/20260427101010.html',
      rawContent: '<p>摘要</p>',
      extractedText: '摘要',
      excerpt: '摘要',
    }],
  }],
  llmInput: '摘要',
  totalReports: 1,
  usedSources: ['jinshi-market-brief-worker'],
  missingSources: ['reddit-stocks-digest-worker'],
  droppedReportKeys: [],
};

describe('buildDetailedReport', () => {
  it('includes conclusion and source coverage', () => {
    const report = buildDetailedReport({
      generatedAt: new Date('2026-04-27T15:45:00.000Z'),
      tradeDate: '2026-04-27',
      conclusion,
      context,
      reportUrl: 'https://example.com/report.html',
    });
    expect(report).toContain('<!doctype html>');
    expect(report).toContain('市场综合判断日报');
    expect(report).toContain('GPT 5.4 (xhigh)');
    expect(report).toContain('jinshi-market-brief-worker');
    expect(report).toContain('缺失来源');
  });
});
