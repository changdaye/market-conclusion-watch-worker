import { describe, expect, it } from 'vitest';
import worker from '../src/index';

describe('admin trigger', () => {
  it('rejects unauthenticated manual trigger calls', async () => {
    const response = await worker.fetch(new Request('https://example.com/admin/trigger', { method: 'POST' }), {
      MANUAL_TRIGGER_TOKEN: 'secret',
      RUNTIME_KV: { get: async () => null, put: async () => undefined } as any,
    } as any);
    expect(response.status).toBe(401);
  });
});
