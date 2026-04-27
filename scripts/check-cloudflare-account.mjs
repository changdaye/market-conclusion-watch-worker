import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const match = config.match(/"account_id"\s*:\s*"([a-f0-9]+)"/i);
if (!match) {
  console.error('未在 wrangler.jsonc 中找到 account_id，无法校验 Cloudflare 账号。');
  process.exit(1);
}
const expectedAccountId = match[1];
let whoami;
try {
  whoami = JSON.parse(execFileSync('npx', ['wrangler', 'whoami', '--json'], { encoding: 'utf8' }));
} catch {
  console.error('无法读取当前 Cloudflare 登录状态，请先执行 npx wrangler login。');
  process.exit(1);
}
const matchedAccount = Array.isArray(whoami.accounts)
  ? whoami.accounts.find((account) => account.id === expectedAccountId)
  : undefined;
if (!matchedAccount) {
  console.error(`当前 Cloudflare 登录账号不包含目标 account_id: ${expectedAccountId}`);
  console.error('请重新执行 npx wrangler login，并登录到正确的 Cloudflare 账号后再部署。');
  process.exit(1);
}
console.log(`Cloudflare 账号校验通过: ${matchedAccount.name} (${matchedAccount.id})`);
