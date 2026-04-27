import type { RuntimeState } from '../types';

const KEY = 'market-conclusion-watch-worker:runtime_state';

export async function getRuntimeState(kv: KVNamespace): Promise<RuntimeState> {
  const raw = await kv.get(KEY);
  if (!raw) return { consecutiveFailures: 0 };
  return JSON.parse(raw) as RuntimeState;
}

export async function setRuntimeState(kv: KVNamespace, state: RuntimeState): Promise<void> {
  await kv.put(KEY, JSON.stringify(state));
}

export function recordSuccess(state: RuntimeState, now = new Date()): RuntimeState {
  return {
    ...state,
    lastSuccessAt: now.toISOString(),
    lastError: undefined,
    consecutiveFailures: 0,
  };
}

export function recordFailure(state: RuntimeState, error: string, now = new Date()): RuntimeState {
  return {
    ...state,
    lastFailureAt: now.toISOString(),
    lastError: error,
    consecutiveFailures: state.consecutiveFailures + 1,
  };
}

export function shouldSendHeartbeat(state: RuntimeState, intervalHours: number, now = new Date()): boolean {
  if (!state.lastHeartbeatAt) return true;
  const previous = Date.parse(state.lastHeartbeatAt);
  return Number.isNaN(previous) || now.getTime() >= previous + intervalHours * 60 * 60 * 1000;
}

export function shouldSendFailureAlert(state: RuntimeState, threshold: number, cooldownMinutes: number, now = new Date()): boolean {
  if (state.consecutiveFailures < threshold) return false;
  if (!state.lastAlertAt) return true;
  const previous = Date.parse(state.lastAlertAt);
  return Number.isNaN(previous) || now.getTime() >= previous + cooldownMinutes * 60 * 1000;
}
