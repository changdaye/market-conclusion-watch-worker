import type { AppConfig, CosObjectSummary } from '../types';
import { buildDetailedReportObjectKey } from '../lib/report';

const SIGN_VALID_SECONDS = 3600;

function encodeCos(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function toHex(data: ArrayBuffer): string {
  return [...new Uint8Array(data)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return toHex(digest);
}

async function hmacSha1Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return toHex(signature);
}

async function buildCosAuthorization(config: AppConfig, method: string, pathname: string, headers: Map<string, string>, query: URLSearchParams, now: Date): Promise<string> {
  const start = Math.floor(now.getTime() / 1000);
  const end = start + SIGN_VALID_SECONDS;
  const keyTime = `${start};${end}`;
  const signKey = await hmacSha1Hex(config.cosSecretKey, keyTime);
  const headerEntries = [...headers.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const headerList = headerEntries.map(([key]) => key).join(';');
  const httpHeaders = headerEntries.map(([key, value]) => `${encodeCos(key)}=${encodeCos(value)}`).join('&');
  const queryEntries = [...query.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const paramList = queryEntries.map(([key]) => key.toLowerCase()).join(';');
  const httpParameters = queryEntries.map(([key, value]) => `${encodeCos(key.toLowerCase())}=${encodeCos(value)}`).join('&');
  const httpString = `${method.toLowerCase()}\n${pathname}\n${httpParameters}\n${httpHeaders}\n`;
  const stringToSign = `sha1\n${keyTime}\n${await sha1Hex(httpString)}\n`;
  const signature = await hmacSha1Hex(signKey, stringToSign);
  return `q-sign-algorithm=sha1&q-ak=${config.cosSecretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=${headerList}&q-url-param-list=${paramList}&q-signature=${signature}`;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseListXml(xml: string): { objects: CosObjectSummary[]; nextContinuationToken?: string } {
  const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((match) => {
    const block = match[1];
    const key = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] ?? '';
    const lastModified = block.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1];
    const sizeRaw = block.match(/<Size>(\d+)<\/Size>/)?.[1];
    return {
      key: decodeXml(key),
      lastModified,
      size: sizeRaw ? Number(sizeRaw) : undefined,
    };
  }).filter((item) => item.key);
  const nextContinuationToken = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1];
  return { objects, nextContinuationToken: nextContinuationToken ? decodeXml(nextContinuationToken) : undefined };
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

async function cosRequest(config: AppConfig, method: string, url: URL, contentType = ''): Promise<Response> {
  const date = new Date();
  const headers = new Map<string, string>([['date', date.toUTCString()], ['host', url.host]]);
  if (contentType) headers.set('content-type', contentType);
  const authorization = await buildCosAuthorization(config, method, url.pathname, headers, url.searchParams, date);
  return fetchWithTimeout(url.toString(), {
    method,
    headers: {
      Authorization: authorization,
      Date: headers.get('date')!,
      ...(contentType ? { 'Content-Type': contentType } : {}),
    },
  }, config.requestTimeoutMs);
}

export async function uploadDetailedReportToCos(config: AppConfig, content: string, now = new Date()): Promise<{ key: string; url: string }> {
  const key = buildDetailedReportObjectKey(now);
  const objectUrl = `${config.cosBaseUrl.replace(/\/+$/, '')}/${key}`;
  const url = new URL(objectUrl);
  const contentType = 'text/html; charset=utf-8';
  const date = now.toUTCString();
  const headers = new Map<string, string>([
    ['content-type', contentType],
    ['date', date],
    ['host', url.host],
  ]);
  const authorization = await buildCosAuthorization(config, 'put', url.pathname, headers, new URLSearchParams(), now);
  const response = await fetchWithTimeout(objectUrl, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      Date: date,
      'Content-Type': contentType,
    },
    body: content,
  }, config.requestTimeoutMs);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`COS upload HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return { key, url: objectUrl };
}

export async function listCosObjects(config: AppConfig, prefix: string): Promise<CosObjectSummary[]> {
  const objects: CosObjectSummary[] = [];
  let continuationToken: string | undefined;
  do {
    const url = new URL(config.cosBaseUrl.replace(/\/+$/, '') + '/');
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', `${prefix}/`);
    url.searchParams.set('max-keys', '1000');
    if (continuationToken) url.searchParams.set('continuation-token', continuationToken);
    const response = await cosRequest(config, 'GET', url);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`COS list HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    const parsed = parseListXml(await response.text());
    objects.push(...parsed.objects);
    continuationToken = parsed.nextContinuationToken;
  } while (continuationToken);
  return objects;
}

export async function fetchCosObjectText(config: AppConfig, key: string): Promise<string> {
  const url = `${config.cosBaseUrl.replace(/\/+$/, '')}/${key}`;
  const response = await fetchWithTimeout(url, {}, config.requestTimeoutMs);
  if (!response.ok) throw new Error(`COS object HTTP ${response.status} for ${key}`);
  return response.text();
}
