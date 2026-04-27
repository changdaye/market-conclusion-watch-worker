# market-conclusion-watch-worker

一个基于 **Cloudflare Workers + KV + Workers AI / OpenAI-compatible LLM + 腾讯云 COS** 的市场综合判断日报项目。

它会在深夜定时读取腾讯云 COS 中最近 3 天的多来源详细报告，提取正文、去重裁剪后交给大模型，生成 **市场判断 + 明确投资动作**，再推送飞书并上传新的详细版 HTML 报告。

## 当前能力

- 每天 **23:45（Asia/Shanghai）** 定时运行
- 从 COS 存储桶 `cloudflare-static-1252612849` 读取最近 3 天报告
- 固定覆盖 6 个上游前缀：
  - `a-share-margin-sentiment-worker`
  - `jinshi-market-brief-worker`
  - `portfolio-valuation-watch-worker`
  - `reddit-stocks-digest-worker`
  - `taoguba-hot-topics-worker`
  - `trump-truth-social-digest-worker`
- 生成 **标准型** 结论：市场判断 / 投资动作 / 核心依据 / 风险提示
- 飞书短消息遵循现有规则：
  - 不显示顶部标题
  - 不显示时间
  - 不显示源帖链接
  - 末尾附详细版报告 URL
- 详细版 HTML 报告上传腾讯云 COS，并可经 Worker 路由访问副本
- 保留 `/health` 与 `/admin/trigger` 用于验收和手动触发
- 支持心跳推送与连续失败告警

## 详细报告来源

默认从以下 COS 前缀读取详细报告：

- `a-share-margin-sentiment-worker`
- `jinshi-market-brief-worker`
- `portfolio-valuation-watch-worker`
- `reddit-stocks-digest-worker`
- `taoguba-hot-topics-worker`
- `trump-truth-social-digest-worker`

默认按对象 key 时间戳筛选最近 3 天报告，兼容 `.html` / `.md` / `.txt` 文本类报告，主路径优先处理 HTML。

## 本地开发

```bash
npm install
npm run check
npx wrangler dev
```

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

## Admin 接口

### 手动触发日报

```bash
curl -X POST   -H "Authorization: Bearer YOUR_MANUAL_TRIGGER_TOKEN"   https://<your-worker>/admin/trigger
```

返回示例：

```json
{
  "ok": true,
  "tradeDate": "2026-04-27",
  "reportUrl": "https://.../market-conclusion-watch-worker/20260427154530.html",
  "action": "观望",
  "messagePreview": "..."
}
```

## 环境变量

敏感信息通过 `.dev.vars` 或 Cloudflare secrets 注入；不要提交到公开仓库。

参见：
- `.dev.vars.example`
- `wrangler.jsonc`

## 风险说明

- 上游详细报告的版式可能变化，正文抽取规则需要持续观察
- 最近 3 天的全量报告可能出现观点冲突，模型会偏保守输出
- 如果个别来源缺失，本次结论会继续生成，但会在报告里注明覆盖缺口
- 当 OpenAI-compatible 代理异常时，会回退到 Cloudflare Workers AI
