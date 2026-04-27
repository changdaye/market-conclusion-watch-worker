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

const FINAL_SYSTEM_PROMPT = `你是一名中文财经策略编辑。你会基于最近三天的多来源市场总结，输出一个严格 JSON 对象，不要 markdown，不要代码块。

要求：
1. 只做市场级/组合级判断，不给个股买卖指令。
2. action 必须是以下枚举之一：观望、轻仓试探、分批布局、持有等待、降低仓位、偏防守。
3. marketView 必须是一句真正的综合结论，不能只是来源标题、报告标题、栏目名或原文小标题。
4. keyDrivers 输出 2 到 4 条，riskWarnings 输出 1 到 3 条。
5. 优先综合多个来源的共识与冲突，不要直接复述任一来源标题。
6. JSON 结构：{"marketView":string,"action":string,"actionRationale":string,"keyDrivers":string[],"riskWarnings":string[],"confidence":"high"|"medium"|"low"}`;

const SOURCE_SYSTEM_PROMPT = `你是一名中文财经编辑。请阅读单一来源最近三天的材料，输出严格 JSON，不要 markdown，不要代码块。

要求：
1. sourceView 用 1 句话概括该来源最近三天最重要的市场判断。
2. keyPoints 输出 2 到 4 条，聚焦真正影响市场的关键信号。
3. riskPoints 输出 1 到 3 条，聚焦该来源提示的主要风险或不确定性。
4. 不要照抄报告标题，不要输出“详细版”“日报”等栏目名称。
5. JSON 结构：{"sourceView":string,"keyPoints":string[],"riskPoints":string[]}`;

const REPAIR_SYSTEM_PROMPT = `你是 JSON 修复器。请把用户给出的内容修复为严格合法的 JSON。
要求：
1. 只能输出修复后的 JSON 本身。
2. 不要解释，不要 markdown，不要代码块。
3. 尽量保持原意，只修语法。`;

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

function extractJsonObject(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = (fenced ?? content).trim();
  const start = source.indexOf('{');
  if (start < 0) return source;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  const end = source.lastIndexOf('}');
  return end > start ? source.slice(start, end + 1) : source.slice(start);
}

function normalizeConclusion(parsed: any, modelLabel: string, llmBackend: 'proxy' | 'workers-ai', upstreamError?: string): MarketConclusion {
  const action = ACTIONS.includes(parsed?.action) ? parsed.action : '观望';
  const keyDrivers = Array.isArray(parsed?.keyDrivers) ? parsed.keyDrivers.map((item: unknown) => String(item).trim()).filter(Boolean).slice(0, 4) : [];
  const riskWarnings = Array.isArray(parsed?.riskWarnings) ? parsed.riskWarnings.map((item: unknown) => String(item).trim()).filter(Boolean).slice(0, 3) : [];
  const confidence = parsed?.confidence === 'high' || parsed?.confidence === 'medium' || parsed?.confidence === 'low'
    ? parsed.confidence
    : 'medium';
  return {
    marketView: String(parsed?.marketView ?? '').trim() || '市场信息分化，短期更适合保持审慎。',
    action,
    actionRationale: String(parsed?.actionRationale ?? '').trim() || '当前跨来源信号不够一致，先控制动作强度。',
    keyDrivers: keyDrivers.length ? keyDrivers : ['最近三天多来源信息存在分化。'],
    riskWarnings: riskWarnings.length ? riskWarnings : ['请结合后续新报告与市场变化持续复核。'],
    confidence,
    modelLabel,
    fallbackUsed: false,
    llmBackend,
    upstreamError,
  };
}

function normalizeSourceSummary(parsed: any, sourceName: string): SourceSummary {
  const keyPoints = Array.isArray(parsed?.keyPoints) ? parsed.keyPoints.map((item: unknown) => String(item).trim()).filter(Boolean).slice(0, 4) : [];
  const riskPoints = Array.isArray(parsed?.riskPoints) ? parsed.riskPoints.map((item: unknown) => String(item).trim()).filter(Boolean).slice(0, 3) : [];
  return {
    sourceName,
    sourceView: String(parsed?.sourceView ?? '').trim() || `${sourceName} 近三天观点偏中性。`,
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

async function parseWithRepair<T>(
  rawContent: string,
  parse: (parsed: any) => T,
  repair: () => Promise<string>,
): Promise<T> {
  try {
    return parse(JSON.parse(extractJsonObject(rawContent)));
  } catch {
    const repaired = await repair();
    return parse(JSON.parse(extractJsonObject(repaired)));
  }
}

async function invokeModel<T>(
  config: AppConfig,
  ai: Ai | undefined,
  systemPrompt: string,
  userContent: string,
  parse: (parsed: any) => T,
): Promise<ModelCallResult<T>> {
  let proxyError = '';
  if (config.llmBaseUrl && config.llmApiKey) {
    try {
      const content = await callOpenAICompatible(config, systemPrompt, userContent);
      const value = await parseWithRepair(content, parse, () => callOpenAICompatible(config, REPAIR_SYSTEM_PROMPT, `请修复下面的 JSON：\n${content}`));
      return { value, backend: 'proxy' };
    } catch (error) {
      proxyError = error instanceof Error ? error.message : String(error);
      console.error('OpenAI-compatible LLM failed', proxyError);
    }
  }

  if (!ai) throw new Error(proxyError || 'Workers AI binding unavailable');
  const model = config.llmModel.startsWith('@cf/') ? config.llmModel : DEFAULT_WORKERS_AI_MODEL;
  const content = await callWorkersAI(ai, model, systemPrompt, userContent);
  const value = await parseWithRepair(content, parse, () => callWorkersAI(ai, model, REPAIR_SYSTEM_PROMPT, `请修复下面的 JSON：\n${content}`));
  return {
    value,
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
      (parsed) => normalizeSourceSummary(parsed, group.sourcePrefix),
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
        (parsed) => normalizeSourceSummary(parsed, `stage-${index + 1}`),
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
      (parsed) => normalizeConclusion(parsed, '', 'proxy'),
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
