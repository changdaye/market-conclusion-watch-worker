const REPORT_STORAGE_PREFIX = 'detailed-report:';
const REPORT_ROUTE_PREFIX = '/reports/';

function toStorageKey(key: string): string {
  return `${REPORT_STORAGE_PREFIX}${key}`;
}

export async function saveDetailedReportCopy(kv: KVNamespace, key: string, content: string): Promise<void> {
  await kv.put(toStorageKey(key), content);
}

export async function loadDetailedReportCopy(kv: KVNamespace, key: string): Promise<string | null> {
  return kv.get(toStorageKey(key));
}

export function buildDetailedReportPublicUrl(baseUrl: string, key: string): string {
  const trimmedBaseUrl = baseUrl.replace(/\/+$/, '');
  const encodedKey = key.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `${trimmedBaseUrl}${REPORT_ROUTE_PREFIX}${encodedKey}`;
}

export function readDetailedReportKeyFromPathname(pathname: string): string | undefined {
  if (!pathname.startsWith(REPORT_ROUTE_PREFIX)) return undefined;
  const rawKey = pathname.slice(REPORT_ROUTE_PREFIX.length);
  if (!rawKey) return undefined;
  return rawKey.split('/').map((segment) => decodeURIComponent(segment)).join('/');
}

export async function maybeHandleDetailedReportRequest(request: Request, kv: KVNamespace): Promise<Response | undefined> {
  const key = readDetailedReportKeyFromPathname(new URL(request.url).pathname);
  if (!key) return undefined;
  const content = await loadDetailedReportCopy(kv, key);
  if (content == null) return new Response('not found', { status: 404 });
  return new Response(content, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
