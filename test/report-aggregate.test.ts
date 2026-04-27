import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config';
import { aggregateReports } from '../src/lib/report-aggregate';
import type { SourceReport } from '../src/types';

const makeReport = (sourcePrefix: string, key: string, extractedText: string): SourceReport => ({
  sourcePrefix,
  key,
  generatedAt: key.includes('103000') ? '2026-04-27T10:30:00Z' : '2026-04-27T10:00:00Z',
  publicUrl: `https://example.com/${key}`,
  rawContent: extractedText,
  extractedText,
  excerpt: extractedText.slice(0, 50),
});

describe('aggregateReports', () => {
  it('dedupes repeated reports and tracks missing sources', () => {
    const config = parseConfig({ MAX_TOTAL_CHARS: '5000', MAX_SOURCE_CHARS: '2000', MAX_REPORT_CHARS: '1000', MAX_REPORTS_PER_SOURCE: '2' } as any);
    const context = aggregateReports([
      makeReport('jinshi-market-brief-worker', 'jinshi-market-brief-worker/20260427100000.html', '市场情绪改善，风险偏好回暖。'),
      makeReport('jinshi-market-brief-worker', 'jinshi-market-brief-worker/20260427103000.html', '市场情绪改善，风险偏好回暖。'),
    ], config);

    expect(context.totalReports).toBe(1);
    expect(context.usedSources).toEqual(['jinshi-market-brief-worker']);
    expect(context.missingSources).toContain('portfolio-valuation-watch-worker');
    expect(context.droppedReportKeys).toContain('jinshi-market-brief-worker/20260427100000.html');
  });
});
