import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectRecentSourceReports } from '../src/services/cos-source';
import * as cos from '../src/services/cos';
import { parseConfig } from '../src/config';

describe('collectRecentSourceReports', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filters to recent archived feishu txt files and extracts text', async () => {
    vi.spyOn(cos, 'listCosObjects').mockImplementation(async () => [
      { key: `jinshi-market-brief-worker/feishu-messages/20260427101010.txt` },
      { key: `jinshi-market-brief-worker/feishu-messages/20250427101010.txt` },
    ]);
    vi.spyOn(cos, 'fetchCosObjectText').mockImplementation(async (_config, key) => `【今日结论】
${key}`);
    const config = parseConfig({ SOURCE_PREFIXES: 'jinshi-market-brief-worker', LOOKBACK_DAYS: '3' } as any);

    const reports = await collectRecentSourceReports(config, new Date('2026-04-27T12:00:00Z'));
    expect(reports).toHaveLength(1);
    expect(reports[0]?.key).toContain('feishu-messages/20260427101010.txt');
    expect(reports[0]?.extractedText).toContain('【今日结论】');
  });
});
