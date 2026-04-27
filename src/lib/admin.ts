export function authorizeAdminRequest(request: Request, token: string): { ok: boolean; status: number; error?: string } {
  if (!token.trim()) return { ok: false, status: 401, error: 'manual trigger token missing' };
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${token}`) return { ok: false, status: 401, error: 'unauthorized' };
  return { ok: true, status: 200 };
}
