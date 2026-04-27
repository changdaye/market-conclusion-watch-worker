import type { AggregatedContext, AppConfig, InvestmentAction, MarketConclusion, SourceReportGroup } from '../types';

const DEFAULT_WORKERS_AI_MODEL = '@cf/meta/llama-3.2-1b-instruct';
const OPENAI_COMPAT_REASONING_EFFORT = 'xhigh';
const OPENAI_COMPAT_MAX_COMPLETION_TOKENS = 700;
const ACTIONS: InvestmentAction[] = ['观望', '轻仓试探', '分批布局', '持有等待', '降低仓位', '偏防守'];
const GROUP_BATCH_SIZE = 3;

interface WorkersAIResult {
  response?: string;
}

interface OpenAICompatResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

interface SourceSummary {
  sourceName: string;
  sourceView: string;
  keyPoints: string[];
  riskPoints: string[];
}

interface ModelCallResult<T> {
  value: T;
  backend: 'proxy' | 'workers-ai';
  proxyError?: string;
}

const FINAL_SYSTEM_PROMPT = `你是一名中文财经策略编辑。你会基于最近三天的多来源市场总结，输出结构化标签文本，不要 markdown，不要代码块。

要求：
1. 只做市场级/组合级判断，不给个股买卖指令。
2. ACTION 必须是以下枚举之一：观望、轻仓试探、分批布局、持有等待、降低仓位、偏防守。
3. MARKET_VIEW 必须是一句真正的综合结论，不能只是来源标题、报告标题、栏目名或原文小标题。
4. KEY_DRIVERS 输出 2 到 4 条，RISK_WARNINGS 输出 1 到 3 条。
5. 优先综合多个来源的共识与冲突，不要直接复述任一来源标题。
6. 严格按以下格式输出：
MARKET_VIEW: ...
ACTION: ...
RATIONALE: ...
KEY_DRIVERS:
- ...
- ...
RISK_WARNINGS:
- ...
- ...
CONFIDENCE: high|medium|low`;

const SOURCE_SYSTEM_PROMPT = `你是一名中文财经编辑。请阅读单一来源最近三天的材料，输出结构化标签文本，不要 markdown，不要代码块。

要求：
1. SOURCE_VIEW 用 1 句话概括该来源最近三天最重要的市场判断。
2. KEY_POINTS 输出 2 到 4 条，聚焦真正影响市场的关键信号。
3. RISK_POINTS 输出 1 到 3 条，聚焦该来源提示的主要风险或不确定性。
4. 不要照抄报告标题，不要输出“详细版”“日报”等栏目名称。
5. 严格按以下格式输出：
SOURCE_VIEW: ...
KEY_POINTS:
- ...
- ...
RISK_POINTS:
- ...
- ...`;

function fallbackConclusion(context: AggregatedContext, reason?: string): MarketConclusion {
  return {
    marketView: context.totalReports ? '最近三天的多来源信息存在分化，短期更适合保持审慎。' : '最近三天可用来源不足，当前缺乏足够材料支撑积极判断。',
    action: context.totalReports ? '观望' : '偏防守',
    actionRationale: context.totalReports ? '信息覆盖虽有一定基础，但跨来源结论不完全一致，先等待更多一致信号。' : '可用来源过少，为避免基于不完整信息做出过度判断，先维持保守动作。',
    keyDrivers: context.totalReports ? [
      `本次纳入 ${context.totalReports} 份最近三天报告，覆盖 ${context.usedSources.length} 个来源。`,
      '来源之间可能存在不同市场侧重点与节奏差异，需要降低动作强度。',
    ] : ['本次未成功纳入足够多的详细报告。'],
    riskWarnings: [
      context.missingSources.length ? `缺失来源：${context.missingSources.join(' / ')}` : '模型调用失败，当前结论为规则兜底。',
    ],
    confidence: context.totalReports >= 4 ? 'medium' : 'low',
    modelLabel: '',
    fallbackUsed: true,
    fallbackReason: reason,
    llmBackend: 'fallback',
    upstreamError: reason,
  };
}

function formatModelLabel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return 'Unknown';
  const slug = trimmed.replace(/^@cf\//, '').split('/').pop() ?? trimmed;
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'gpt') return 'GPT';
      if (lower === 'llama') return 'Llama';
      if (lower === 'qwen') return 'Qwen';
      if (lower === 'gemma') return 'Gemma';
      if (lower === 'glm') return 'GLM';
      if (lower === 'mistral') return 'Mistral';
      if (lower === 'kimi') return 'Kimi';
      if (lower === 'deepseek') return 'DeepSeek';
      if (/^\d+(\.\d+)?b$/i.test(part)) return part.toUpperCase();
      if (/^\d+(\.\d+)?$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function parseBullets(block: string): string[] {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

function extractSection(content: string, key: string): string {
  const regex = new RegExp(`${key}:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`, 'i');
  return content.match(regex)?.[1]?.trim() ?? '';
}

function normalizeConclusionFromText(content: string, modelLabel: string, llmBackend: 'proxy' | 'workers-ai', upstreamError?: string): MarketConclusion {
  const marketView = extractSection(content, 'MARKET_VIEW').split('\n')[0]?.trim() || '市场信息分化，短期更适合保持审慎。';
  const actionRaw = extractSection(content, 'ACTION').split('\n')[0]?.trim() || '观望';
  const action = ACTIONS.includes(actionRaw as InvestmentAction) ? actionRaw as InvestmentAction : '观望';
  const rationale = extractSection(content, 'RATIONALE').split('\n')[0]?.trim() || '当前跨来源信号不够一致，先控制动作强度。';
  const keyDrivers = parseBullets(extractSection(content, 'KEY_DRIVERS')).slice(0, 4);
  const riskWarnings = parseBullets(extractSection(content, 'RISK_WARNINGS')).slice(0, 3);
  const confidenceRaw = extractSection(content, 'CONFIDENCE').split('\n')[0]?.trim().toLowerCase();
  const confidence = confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low' ? confidenceRaw : 'medium';
  return {
    marketView,
    action,
    actionRationale: rationale,
    keyDrivers: keyDrivers.length ? keyDrivers : ['最近三天多来源信息存在分化。'],
    riskWarnings: riskWarnings.length ? riskWarnings : ['请结合后续新报告与市场变化持续复核。'],
    confidence,
    modelLabel,
    fallbackUsed: false,
    llmBackend,
    upstreamError,
  };
}

function normalizeSourceSummaryFromText(content: string, sourceName: string): SourceSummary {
  const sourceView = extractSection(content, 'SOURCE_VIEW').split('\n')[0]?.trim() || `${sourceName} 近三天观点偏中性。`;
  const keyPoints = parseBullets(extractSection(content, 'KEY_POINTS')).slice(0, 4);
  const riskPoints = parseBullets(extractSection(content, 'RISK_POINTS')).slice(0, 3);
  return {
    sourceName,
    sourceView,
    keyPoints: keyPoints.length ? keyPoints : ['该来源未提供足够清晰的关键信号。'],
    riskPoints: riskPoints.length ? riskPoints : ['该来源风险提示有限，需要结合其他来源复核。'],
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAICompatible(config: AppConfig, systemPrompt: string, userContent: string): Promise<string> {
  const response = await fetchWithTimeout(`${config.llmBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.llmApiKey}`,
    },
    body: JSON.stringify({
      model: config.llmModel,
      reasoning_effort: OPENAI_COMPAT_REASONING_EFFORT,
      max_completion_tokens: OPENAI_COMPAT_MAX_COMPLETION_TOKENS,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.2,
    }),
  }, Math.max(config.requestTimeoutMs, 30000));
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI-compatible HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  const result = await response.json() as OpenAICompatResponse;
  const rawContent = result.choices?.[0]?.message?.content;
  const content = typeof rawContent === 'string'
    ? rawContent.trim()
    : rawContent?.map((part) => part.text ?? '').join('').trim();
  if (!content) throw new Error('OpenAI-compatible response returned empty content');
  return content;
}

async function callWorkersAI(ai: Ai, model: string, systemPrompt: string, userContent: string): Promise<string> {
  const result = await ai.run(model, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    max_tokens: 900,
    temperature: 0.2,
  }) as WorkersAIResult;
  const content = result.response?.trim();
  if (!content) throw new Error('Workers AI returned empty response');
  return content;
}

async function invokeModel<T>(
  config: AppConfig,
  ai: Ai | undefined,
  systemPrompt: string,
  userContent: string,
  parse: (content: string) => T,
): Promise<ModelCallResult<T>> {
  let proxyError = '';
  if (config.llmBaseUrl && config.llmApiKey) {
    try {
      const content = await callOpenAICompatible(config, systemPrompt, userContent);
      return { value: parse(content), backend: 'proxy' };
    } catch (error) {
      proxyError = error instanceof Error ? error.message : String(error);
      console.error('OpenAI-compatible LLM failed', proxyError);
    }
  }

  if (!ai) throw new Error(proxyError || 'Workers AI binding unavailable');
  const model = config.llmModel.startsWith('@cf/') ? config.llmModel : DEFAULT_WORKERS_AI_MODEL;
  const content = await callWorkersAI(ai, model, systemPrompt, userContent);
  return {
    value: parse(content),
    backend: 'workers-ai',
    proxyError,
  };
}

function buildSourcePrompt(group: SourceReportGroup): string {
  const snippets = group.reports.map((report, index) => [
    `材料 ${index + 1}`,
    `时间：${report.generatedAt}`,
    `摘要：${report.excerpt || report.extractedText}`,
  ].join('\n')).join('\n\n');
  return `来源：${group.sourcePrefix}\n请基于以下最近三天材料做单来源总结：\n\n${snippets}`;
}

function buildBatchPrompt(summaries: SourceSummary[]): string {
  return summaries.map((summary, index) => [
    `来源总结 ${index + 1}`,
    `来源：${summary.sourceName}`,
    `观点：${summary.sourceView}`,
    `关键信号：${summary.keyPoints.join('；')}`,
    `风险：${summary.riskPoints.join('；')}`,
  ].join('\n')).join('\n\n');
}

function buildFinalPrompt(context: AggregatedContext, summaries: SourceSummary[]): string {
  const coverage = [
    `已覆盖来源：${context.usedSources.join(' / ') || '无'}`,
    `缺失来源：${context.missingSources.join(' / ') || '无'}`,
  ].join('\n');
  return `${coverage}\n\n${buildBatchPrompt(summaries)}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

export async function summarizeWithLLM(config: AppConfig, ai: Ai | undefined, context: AggregatedContext): Promise<MarketConclusion> {
  if (!context.totalReports) return fallbackConclusion(context, '无可用 LLM 输入');

  try {
    const activeGroups = context.groups.filter((group) => group.reports.length > 0);

    const sourceStage = await Promise.all(activeGroups.map((group) => invokeModel(
      config,
      ai,
      SOURCE_SYSTEM_PROMPT,
      buildSourcePrompt(group),
      (content) => normalizeSourceSummaryFromText(content, group.sourcePrefix),
    )));

    let proxyErrors = sourceStage.map((result) => result.proxyError).filter(Boolean).join('；');
    let summaries = sourceStage.map((result) => result.value);
    let backend: 'proxy' | 'workers-ai' = sourceStage.some((result) => result.backend === 'workers-ai') ? 'workers-ai' : 'proxy';

    while (summaries.length > GROUP_BATCH_SIZE) {
      const batches = chunk(summaries, GROUP_BATCH_SIZE);
      const batchStage = await Promise.all(batches.map((batch, index) => invokeModel(
        config,
        ai,
        SOURCE_SYSTEM_PROMPT,
        `请把以下多个来源总结再压缩成一个更高层次的阶段总结。阶段：${index + 1}\n\n${buildBatchPrompt(batch)}`,
        (content) => normalizeSourceSummaryFromText(content, `stage-${index + 1}`),
      )));
      const batchErrors = batchStage.map((result) => result.proxyError).filter(Boolean).join('；');
      if (batchErrors) proxyErrors = proxyErrors ? `${proxyErrors}；${batchErrors}` : batchErrors;
      if (batchStage.some((result) => result.backend === 'workers-ai')) backend = 'workers-ai';
      summaries = batchStage.map((result) => result.value);
    }

    const finalStage = await invokeModel(
      config,
      ai,
      FINAL_SYSTEM_PROMPT,
      buildFinalPrompt(context, summaries),
      (content) => normalizeConclusionFromText(content, '', 'proxy'),
    );

    if (finalStage.proxyError) proxyErrors = proxyErrors ? `${proxyErrors}；${finalStage.proxyError}` : finalStage.proxyError;
    const finalBackend = finalStage.backend === 'workers-ai' || backend === 'workers-ai' ? 'workers-ai' : 'proxy';
    const modelLabel = finalBackend === 'proxy'
      ? `${formatModelLabel(config.llmModel)} (${OPENAI_COMPAT_REASONING_EFFORT})`
      : formatModelLabel(config.llmModel.startsWith('@cf/') ? config.llmModel : DEFAULT_WORKERS_AI_MODEL);

    return {
      ...finalStage.value,
      modelLabel,
      llmBackend: finalBackend,
      upstreamError: proxyErrors || undefined,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fallbackConclusion(context, detail);
  }
}
