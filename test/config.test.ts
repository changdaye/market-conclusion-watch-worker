import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config';

describe('parseConfig', () => {
  it('uses approved defaults for the new worker', () => {
    const config = parseConfig({});
    expect(config.runHourLocal).toBe(23);
    expect(config.runMinuteLocal).toBe(45);
    expect(config.lookbackDays).toBe(3);
    expect(config.sourcePrefixes).toHaveLength(6);
    expect(config.workerPublicBaseUrl).toBe('https://market-conclusion-watch-worker.wanggejiancai822.workers.dev');
    expect(config.cosBucket).toBe('cloudflare-static-1252612849');
  });
});
