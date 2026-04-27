import type { LastRunRecord, RuntimeState } from '../types';

const KEY = 'market-conclusion-watch-worker:runtime_state';
const LAST_RUN_KEY = 'market-conclusion-watch-worker:last_run';

export async function getRuntimeState(kv: KVNamespace): Promise<RuntimeState> {
  const raw = await kv.get(KEY);
  if (!raw) return { consecutiveFailures: 0 };
  return JSON.parse(raw) as RuntimeState;
}

export async function setRuntimeState(kv: KVNamespace, state: RuntimeState): Promise<void> {
  await kv.put(KEY, JSON.stringify(state));
}

export async function getLastRunRecord(kv: KVNamespace): Promise<LastRunRecord | null> {
  const raw = await kv.get(LAST_RUN_KEY);
  return raw ? JSON.parse(raw) as LastRunRecord : null;
}

export async function setLastRunRecord(kv: KVNamespace, record: LastRunRecord): Promise<void> {
  await kv.put(LAST_RUN_KEY, JSON.stringify(record));
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
