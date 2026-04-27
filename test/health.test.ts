import { describe, expect, it } from 'vitest';
import worker from '../src/index';

class FakeKV {
  async get(): Promise<string | null> {
    return null;
  }
  async put(): Promise<void> {}
}

describe('worker health', () => {
  it('returns config metadata for health', async () => {
    const response = await worker.fetch(new Request('https://example.com/health'), { RUNTIME_KV: new FakeKV() as any } as any, { waitUntil() {} } as any);
    const payload = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload).toHaveProperty('sourcePrefixes');
    expect(payload.project).toBe('market-conclusion-watch-worker');
  });
});
