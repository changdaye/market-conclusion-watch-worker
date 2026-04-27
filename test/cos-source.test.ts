import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectRecentSourceReports } from '../src/services/cos-source';
import * as cos from '../src/services/cos';
import { parseConfig } from '../src/config';

describe('collectRecentSourceReports', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filters to recent timestamped objects and extracts text', async () => {
    vi.spyOn(cos, 'listCosObjects').mockImplementation(async (_config, prefix) => [
      { key: `${prefix}/20260427101010.html` },
      { key: `${prefix}/20250427101010.html` },
    ]);
    vi.spyOn(cos, 'fetchCosObjectText').mockImplementation(async (_config, key) => `<html><body><p>${key}</p></body></html>`);
    const config = parseConfig({ SOURCE_PREFIXES: 'jinshi-market-brief-worker', LOOKBACK_DAYS: '3' } as any);

    const reports = await collectRecentSourceReports(config, new Date('2026-04-27T12:00:00Z'));
    expect(reports).toHaveLength(1);
    expect(reports[0]?.key).toContain('20260427101010.html');
    expect(reports[0]?.extractedText).toContain('20260427101010.html');
  });
});
