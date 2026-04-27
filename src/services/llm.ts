import type { AggregatedContext, AppConfig, InvestmentAction, MarketConclusion } from '../types';

const DEFAULT_WORKERS_AI_MODEL = '@cf/meta/llama-3.2-1b-instruct';
const OPENAI_COMPAT_REASONING_EFFORT = 'xhigh';
const OPENAI_COMPAT_MAX_COMPLETION_TOKENS = 900;
const ACTIONS: InvestmentAction[] = ['观望', '轻仓试探', '分批布局', '持有等待', '降低仓位', '偏防守'];

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

const SYSTEM_PROMPT = `你是一名中文财经策略编辑。你会基于最近三天的多来源市场详细报告，输出一个严格 JSON 对象，不要 markdown，不要代码块。

要求：
1. 只做市场级/组合级判断，不给个股买卖指令。
2. action 必须是以下枚举之一：观望、轻仓试探、分批布局、持有等待、降低仓位、偏防守。
3. keyDrivers 输出 2 到 4 条。
4. riskWarnings 输出 1 到 3 条。
5. 如果来源缺失或观点冲突明显，要在 riskWarnings 中明确说明。
6. JSON 结构：{"marketView":string,"action":string,"actionRationale":string,"keyDrivers":string[],"riskWarnings":string[],"confidence":"high"|"medium"|"low"}`;

function fallbackConclusion(context: AggregatedContext): MarketConclusion {
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
  if (fenced) return fenced.trim();
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  return start >= 0 && end > start ? content.slice(start, end + 1) : content.trim();
}

function normalizeConclusion(parsed: any, modelLabel: string): MarketConclusion {
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
  };
}

async function summarizeWithOpenAICompatible(config: AppConfig, context: AggregatedContext): Promise<MarketConclusion> {
  const response = await fetch(`${config.llmBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
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
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: context.llmInput },
      ],
      temperature: 0.2,
    }),
  });
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
  const parsed = JSON.parse(extractJsonObject(content));
  return normalizeConclusion(parsed, `${formatModelLabel(config.llmModel)} (${OPENAI_COMPAT_REASONING_EFFORT})`);
}

async function summarizeWithWorkersAI(ai: Ai, model: string, context: AggregatedContext): Promise<MarketConclusion> {
  const result = await ai.run(model, {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: context.llmInput },
    ],
    max_tokens: 900,
    temperature: 0.2,
  }) as WorkersAIResult;
  const content = result.response?.trim();
  if (!content) throw new Error('Workers AI returned empty response');
  const parsed = JSON.parse(extractJsonObject(content));
  return normalizeConclusion(parsed, formatModelLabel(model));
}

export async function summarizeWithLLM(config: AppConfig, ai: Ai | undefined, context: AggregatedContext): Promise<MarketConclusion> {
  const fallback = fallbackConclusion(context);
  if (!context.totalReports || !context.llmInput.trim()) return fallback;

  if (config.llmBaseUrl && config.llmApiKey) {
    try {
      return await summarizeWithOpenAICompatible(config, context);
    } catch (error) {
      console.error('OpenAI-compatible LLM failed', error instanceof Error ? error.message : String(error));
    }
  }

  if (!ai) return fallback;
  try {
    return await summarizeWithWorkersAI(ai, config.llmModel.startsWith('@cf/') ? config.llmModel : DEFAULT_WORKERS_AI_MODEL, context);
  } catch (error) {
    console.error('Workers AI LLM failed', error instanceof Error ? error.message : String(error));
    return fallback;
  }
}
