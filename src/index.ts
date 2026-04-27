import { assertRuntimeEnv, parseConfig } from './config';
import { authorizeAdminRequest } from './lib/admin';
import { buildDailyMessage, buildFailureAlertMessage, buildHeartbeatMessage } from './lib/message';
import { buildDetailedReport } from './lib/report';
import { buildDetailedReportPublicUrl, maybeHandleDetailedReportRequest, saveDetailedReportCopy } from './lib/report-storage';
import { aggregateReports } from './lib/report-aggregate';
import { getLastRunRecord, getRuntimeState, patchLastRunRecord, recordFailure, recordSuccess, setLastRunRecord, setRuntimeState, shouldSendFailureAlert, shouldSendHeartbeat } from './lib/runtime';
import { formatDateInZone, weekdayInZone } from './lib/time';
import { uploadDetailedReportToCos } from './services/cos';
import { collectRecentSourceReports } from './services/cos-source';
import { pushToFeishu } from './services/feishu';
import { summarizeWithLLM } from './services/llm';
import type { Env, LastRunRecord, RunResult, RuntimeState } from './types';

function json(data: Record<string, unknown>, status = 200): Response {
  return Response.json(data, { status });
}

function buildSourceSummary(usedSources: string[], missingSources: string[]): string {
  const used = `已覆盖 ${usedSources.length} 个来源：${usedSources.length ? usedSources.join(' / ') : '无'}`;
  const missing = `缺失 ${missingSources.length} 个来源：${missingSources.length ? missingSources.join(' / ') : '无'}`;
  return `${used}\n${missing}`;
}

export async function runDailyDigest(env: Env, now = new Date()): Promise<RunResult> {
  const config = parseConfig(env);
  assertRuntimeEnv(env, config);
  const tradeDate = formatDateInZone(now, config.marketTimezone);
  await patchLastRunRecord(env.RUNTIME_KV, { phase: 'collecting_reports', phaseDetail: '读取 COS 最近 3 天详细报告' });
  const reports = await collectRecentSourceReports(config, now);
  await patchLastRunRecord(env.RUNTIME_KV, { phase: 'aggregating_reports', phaseDetail: `已读取 ${reports.length} 份报告，开始聚合` });
  const context = aggregateReports(reports, config);
  await patchLastRunRecord(env.RUNTIME_KV, { phase: 'summarizing_with_llm', phaseDetail: `纳入 ${context.totalReports} 份报告，覆盖 ${context.usedSources.length} 个来源` });
  const conclusion = await summarizeWithLLM(config, env.AI, context);

  let reportUrl: string | undefined;
  await patchLastRunRecord(env.RUNTIME_KV, { phase: 'rendering_report', phaseDetail: `LLM 后端：${conclusion.llmBackend ?? 'fallback'}` });
  const report = buildDetailedReport({ generatedAt: now, tradeDate, conclusion, context });
  try {
    const uploaded = await uploadDetailedReportToCos(config, report, now);
    await saveDetailedReportCopy(env.RUNTIME_KV, uploaded.key, report);
    reportUrl = buildDetailedReportPublicUrl(config.workerPublicBaseUrl, uploaded.key);
  } catch (error) {
    console.error('Failed to upload report to COS', error);
  }

  await patchLastRunRecord(env.RUNTIME_KV, { phase: 'pushing_feishu', phaseDetail: reportUrl ? '详细版报告已生成，开始推送飞书' : '无详细版链接，开始推送飞书' });
  const messagePreview = buildDailyMessage(conclusion, reportUrl, buildSourceSummary(context.usedSources, context.missingSources));
  await pushToFeishu(config, messagePreview);

  return {
    tradeDate,
    reportUrl,
    messagePreview,
    modelLabel: conclusion.modelLabel,
    conclusion,
    context,
  };
}

async function maybeSendHeartbeat(env: Env, state: RuntimeState, now: Date): Promise<RuntimeState> {
  const config = parseConfig(env);
  if (!config.heartbeatEnabled || !shouldSendHeartbeat(state, config.heartbeatIntervalHours, now)) return state;
  const heartbeat = buildHeartbeatMessage(state, config.heartbeatIntervalHours);
  await pushToFeishu(config, heartbeat);
  return { ...state, lastHeartbeatAt: now.toISOString() };
}

async function executeRunAndPersist(env: Env, trigger: 'manual' | 'scheduled', now = new Date()): Promise<void> {
  await setLastRunRecord(env.RUNTIME_KV, {
    startedAt: now.toISOString(),
    status: 'running',
    trigger,
  });

  const runtime = await getRuntimeState(env.RUNTIME_KV);
  try {
    const result = await runDailyDigest(env, now);
    let nextState = recordSuccess(runtime, now);
    nextState = await maybeSendHeartbeat(env, nextState, now);
    await setRuntimeState(env.RUNTIME_KV, nextState);
    const record: LastRunRecord = {
      startedAt: now.toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'succeeded',
      trigger,
      tradeDate: result.tradeDate,
      reportUrl: result.reportUrl,
      action: result.conclusion.action,
      modelLabel: result.modelLabel,
      fallbackUsed: result.conclusion.fallbackUsed,
      fallbackReason: result.conclusion.fallbackReason,
      llmBackend: result.conclusion.llmBackend,
      upstreamError: result.conclusion.upstreamError,
      messagePreview: result.messagePreview,
      usedSources: result.context.usedSources,
      missingSources: result.context.missingSources,
    };
    await setLastRunRecord(env.RUNTIME_KV, { ...record, phase: 'completed', phaseDetail: '后台任务已完成' });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    let nextState = recordFailure(runtime, detail, now);
    if (shouldSendFailureAlert(nextState, parseConfig(env).failureAlertThreshold, parseConfig(env).failureAlertCooldownMinutes, now)) {
      try {
        await pushToFeishu(parseConfig(env), buildFailureAlertMessage(nextState, parseConfig(env).failureAlertThreshold));
        nextState = { ...nextState, lastAlertAt: now.toISOString() };
      } catch {
        // ignore secondary alert failure
      }
    }
    await setRuntimeState(env.RUNTIME_KV, nextState);
    await setLastRunRecord(env.RUNTIME_KV, {
      startedAt: now.toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'failed',
      trigger,
      phase: 'failed',
      phaseDetail: '后台任务执行失败',
      error: detail,
    });
    throw error;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const config = parseConfig(env);

    if (request.method === 'GET') {
      const reportResponse = await maybeHandleDetailedReportRequest(request, env.RUNTIME_KV);
      if (reportResponse) return reportResponse;
    }

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json({
        ok: true,
        project: 'market-conclusion-watch-worker',
        schedule: {
          weekdays: config.runWeekdays,
          runHourLocal: config.runHourLocal,
          runMinuteLocal: config.runMinuteLocal,
          marketTimezone: config.marketTimezone,
        },
        sourcePrefixes: config.sourcePrefixes,
        lookbackDays: config.lookbackDays,
        heartbeatEnabled: config.heartbeatEnabled,
        runtimeState: await getRuntimeState(env.RUNTIME_KV),
        lastRun: await getLastRunRecord(env.RUNTIME_KV),
      });
    }

    if (request.method === 'GET' && url.pathname === '/admin/last-run') {
      const auth = authorizeAdminRequest(request, config.manualTriggerToken);
      if (!auth.ok) return json({ ok: false, error: auth.error ?? 'unauthorized' }, auth.status);
      return json({ ok: true, lastRun: await getLastRunRecord(env.RUNTIME_KV) });
    }

    if (request.method === 'POST' && url.pathname === '/admin/trigger') {
      const auth = authorizeAdminRequest(request, config.manualTriggerToken);
      if (!auth.ok) return json({ ok: false, error: auth.error ?? 'unauthorized' }, auth.status);
      const startedAt = new Date().toISOString();
      ctx.waitUntil(executeRunAndPersist(env, 'manual', new Date(startedAt)));
      return json({ ok: true, accepted: true, status: 'started', startedAt });
    }

    return json({ ok: false, error: 'not found' }, 404);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const config = parseConfig(env);
    const now = new Date();
    if (!config.runWeekdays.includes(weekdayInZone(now, config.marketTimezone))) return;
    ctx.waitUntil(executeRunAndPersist(env, 'scheduled', now));
  },
};
