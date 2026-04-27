import type { MarketConclusion, RuntimeState } from '../types';

function section(title: string, body: string): string {
  return `【${title}】\n${body}`;
}

export function buildDailyMessage(conclusion: MarketConclusion, reportUrl: string | undefined, sourceSummary: string): string {
  const riskLines = [...conclusion.riskWarnings];
  if (conclusion.fallbackUsed && conclusion.fallbackReason) {
    riskLines.push(`本次为规则兜底：${conclusion.fallbackReason}`);
  }
  const parts = [
    ...(conclusion.modelLabel ? [`🤖 模型：${conclusion.modelLabel}`] : []),
    ...(!conclusion.modelLabel && conclusion.fallbackUsed ? ['🤖 模型：规则兜底'] : []),
    section('综合结论', conclusion.marketView),
    section('操作建议', `${conclusion.action}\n${conclusion.actionRationale}`),
    section('关键信号', conclusion.keyDrivers.map((item) => `- ${item}`).join('\n')),
    section('主要风险', riskLines.map((item) => `- ${item}`).join('\n')),
    section('关注代码', '市场级结论，无个股代码'),
    section('来源覆盖', sourceSummary),
  ];
  if (reportUrl) parts.push(`详细版报告:\n${reportUrl}`);
  return parts.join('\n\n');
}

export function buildHeartbeatMessage(state: RuntimeState, intervalHours: number): string {
  return [
    '💓 市场综合判断 Worker 心跳',
    `心跳间隔: ${intervalHours}h`,
    `上次成功: ${state.lastSuccessAt ?? '无'}`,
    `连续失败: ${state.consecutiveFailures}`,
  ].join('\n');
}

export function buildFailureAlertMessage(state: RuntimeState, threshold: number): string {
  return [
    '🚨 市场综合判断 Worker 异常告警',
    `连续失败: ${state.consecutiveFailures}`,
    `告警阈值: ${threshold}`,
    `最近错误: ${state.lastError ?? 'unknown'}`,
  ].join('\n');
}
