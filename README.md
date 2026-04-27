# market-conclusion-watch-worker

一个基于 **Cloudflare Workers + KV + Workers AI / OpenAI-compatible LLM + 腾讯云 COS** 的市场综合判断日报项目。

它会在每天凌晨 **05:00（Asia/Shanghai）** 定时读取 6 个来源项目各自 `feishu-messages/` 目录下最近几天的飞书短消息文本，做一次统一总结，再推送飞书并上传新的详细版 HTML 报告。

## 当前能力

- 每天 **05:00（Asia/Shanghai）** 定时运行
- 从 COS 存储桶 `cloudflare-static-1252612849` 读取最近 3 天归档飞书消息
- 固定覆盖 6 个上游前缀：
  - `a-share-margin-sentiment-worker`
  - `jinshi-market-brief-worker`
  - `portfolio-valuation-watch-worker`
  - `reddit-stocks-digest-worker`
  - `taoguba-hot-topics-worker`
  - `trump-truth-social-digest-worker`
- 每个来源从其目录下的 `feishu-messages/YYYYMMDDHHMMSS.txt` 读取消息
- 生成 **标准型** 结论：市场判断 / 投资动作 / 核心依据 / 风险提示
- 飞书短消息遵循现有规则：
  - 不显示顶部标题
  - 不显示时间
  - 不显示源帖链接
  - 末尾附详细版报告 URL
- 详细版 HTML 报告上传腾讯云 COS，并可经 Worker 路由访问副本
- 保留 `/health` 与 `/admin/trigger` 用于验收和手动触发
- 支持心跳推送与连续失败告警

## 数据来源

默认读取以下 6 个来源目录下的 `feishu-messages/`：

- `a-share-margin-sentiment-worker/feishu-messages/`
- `jinshi-market-brief-worker/feishu-messages/`
- `portfolio-valuation-watch-worker/feishu-messages/`
- `reddit-stocks-digest-worker/feishu-messages/`
- `taoguba-hot-topics-worker/feishu-messages/`
- `trump-truth-social-digest-worker/feishu-messages/`

默认按对象 key 时间戳筛选最近 3 天消息文本，当前每个来源最多读取最近 1 条消息作为输入。

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

## 环境变量

敏感信息通过 `.dev.vars` 或 Cloudflare secrets 注入；不要提交到公开仓库。

参见：
- `.dev.vars.example`
- `wrangler.jsonc`
