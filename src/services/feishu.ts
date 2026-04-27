import type { AppConfig } from '../types';

interface FeishuResponse {
  code?: number;
  msg?: string;
}

async function sign(secret: string): Promise<{ timestamp: string; sign: string } | undefined> {
  if (!secret) return undefined;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${timestamp}
${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new Uint8Array());
  return { timestamp, sign: btoa(String.fromCharCode(...new Uint8Array(signature))) };
}

export async function pushToFeishu(config: AppConfig, text: string): Promise<void> {
  const signed = await sign(config.feishuSecret);
  const body = {
    msg_type: 'text',
    content: { text },
    ...(signed ?? {}),
  };
  const response = await fetch(config.feishuWebhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`feishu webhook HTTP ${response.status}: ${raw}`);
  const parsed = JSON.parse(raw) as FeishuResponse;
  if ((parsed.code ?? 0) !== 0) throw new Error(`feishu webhook error ${parsed.code}: ${parsed.msg ?? 'unknown'}`);
}
