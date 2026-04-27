import type { AggregatedContext, MarketConclusion } from '../types';
import { compactUtcTimestamp } from './time';

const PREFIX = 'market-conclusion-watch-worker';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildDetailedReportObjectKey(now = new Date()): string {
  return `${PREFIX}/${compactUtcTimestamp(now)}.html`;
}

export function buildDetailedReport(input: {
  generatedAt: Date;
  tradeDate: string;
  reportUrl?: string;
  conclusion: MarketConclusion;
  context: AggregatedContext;
}): string {
  const sourceCards = input.context.groups.map((group) => `
    <section class="card">
      <h2>${escapeHtml(group.sourcePrefix)}</h2>
      <p class="meta">纳入 ${group.reports.length} 份报告</p>
      ${group.reports.length ? group.reports.map((report) => `
        <article class="source-item">
          <div class="meta"><strong>${escapeHtml(report.generatedAt)}</strong> · <a href="${escapeHtml(report.publicUrl)}">原始详细报告</a></div>
          <pre>${escapeHtml(report.extractedText)}</pre>
        </article>
      `).join('') : '<p>本次未纳入该来源报告。</p>'}
    </section>
  `).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>市场综合判断日报</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; margin: 0; background: #f6f8fb; color: #1f2937; }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 32px 20px 48px; }
    .card { background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 6px 24px rgba(15, 23, 42, 0.08); margin-bottom: 20px; }
    h1, h2, h3 { margin-top: 0; }
    .meta { color: #64748b; line-height: 1.8; }
    .headline { font-size: 22px; font-weight: 700; line-height: 1.7; }
    ul { margin: 0; padding-left: 20px; line-height: 1.9; }
    pre { white-space: pre-wrap; word-break: break-word; background: #f8fafc; border-radius: 12px; padding: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .tag { display: inline-block; background: #eef2ff; color: #4338ca; border-radius: 999px; padding: 4px 10px; font-size: 12px; margin-right: 8px; }
    .source-item { margin-top: 18px; }
    a { color: #2563eb; }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="card">
      <h1>市场综合判断日报</h1>
      <div class="meta">
        <div><strong>交易日期：</strong>${escapeHtml(input.tradeDate)}</div>
        <div><strong>生成时间：</strong>${escapeHtml(input.generatedAt.toISOString())}</div>
        <div><strong>模型：</strong>${escapeHtml(input.conclusion.modelLabel || 'fallback')}</div>
        <div><strong>信心：</strong>${escapeHtml(input.conclusion.confidence)}</div>
        ${input.reportUrl ? `<div><strong>报告链接：</strong><a href="${escapeHtml(input.reportUrl)}">打开当前 HTML 报告</a></div>` : ''}
      </div>
    </section>

    <section class="card">
      <div class="tag">市场判断</div>
      <div class="headline">${escapeHtml(input.conclusion.marketView)}</div>
      <h3>投资动作</h3>
      <p><strong>${escapeHtml(input.conclusion.action)}</strong></p>
      <p>${escapeHtml(input.conclusion.actionRationale)}</p>
    </section>

    <section class="card grid">
      <div>
        <h2>核心依据</h2>
        <ul>${input.conclusion.keyDrivers.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>
      <div>
        <h2>风险提示</h2>
        <ul>${input.conclusion.riskWarnings.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>
    </section>

    <section class="card">
      <h2>来源覆盖</h2>
      <div class="meta">
        <div><strong>纳入来源：</strong>${escapeHtml(input.context.usedSources.join(' / ') || '无')}</div>
        <div><strong>缺失来源：</strong>${escapeHtml(input.context.missingSources.join(' / ') || '无')}</div>
        <div><strong>纳入报告数：</strong>${input.context.totalReports}</div>
        <div><strong>被裁剪/去重对象：</strong>${input.context.droppedReportKeys.length}</div>
      </div>
    </section>

    ${sourceCards}
  </div>
</body>
</html>`;
}
