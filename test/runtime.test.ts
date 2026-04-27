import { describe, expect, it } from 'vitest';
import { recordFailure, recordSuccess, shouldSendFailureAlert, shouldSendHeartbeat } from '../src/lib/runtime';

describe('runtime helpers', () => {
  it('sends the first heartbeat when none has been sent', () => {
    expect(shouldSendHeartbeat({ consecutiveFailures: 0 }, 24, new Date('2026-04-27T12:00:00Z'))).toBe(true);
  });

  it('records success and failure transitions', () => {
    const success = recordSuccess({ consecutiveFailures: 2 }, new Date('2026-04-27T12:00:00Z'));
    expect(success.consecutiveFailures).toBe(0);
    const failure = recordFailure(success, 'boom', new Date('2026-04-27T13:00:00Z'));
    expect(failure.consecutiveFailures).toBe(1);
    expect(shouldSendFailureAlert({ ...failure, consecutiveFailures: 3 }, 3, 60, new Date('2026-04-27T13:00:00Z'))).toBe(true);
  });
});
