import { describe, expect, it } from 'vitest';
import { buildDetailedReportPublicUrl, maybeHandleDetailedReportRequest, saveDetailedReportCopy } from '../src/lib/report-storage';

class FakeKV {
  private readonly data = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
}

describe('report storage', () => {
  it('builds nested public report URLs on the worker domain', () => {
    expect(buildDetailedReportPublicUrl('https://demo.example.workers.dev/', 'market-conclusion-watch-worker/20260427154530.html'))
      .toBe('https://demo.example.workers.dev/reports/market-conclusion-watch-worker/20260427154530.html');
  });

  it('serves saved HTML reports from the report route', async () => {
    const kv = new FakeKV() as unknown as KVNamespace;
    await saveDetailedReportCopy(kv, 'market-conclusion-watch-worker/20260427154530.html', '<h1>report</h1>');

    const response = await maybeHandleDetailedReportRequest(
      new Request('https://demo.example.workers.dev/reports/market-conclusion-watch-worker/20260427154530.html'),
      kv,
    );

    expect(response?.status).toBe(200);
    await expect(response?.text()).resolves.toBe('<h1>report</h1>');
    expect(response?.headers.get('content-type')).toContain('text/html');
  });
});
