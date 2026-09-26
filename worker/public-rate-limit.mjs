const PUBLIC_SALES_PATHS = new Set(['/api/sales/inspect', '/api/sales/draft']);

export async function limitPublicSalesEntry(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'POST' || !PUBLIC_SALES_PATHS.has(url.pathname) || !env.DIAGNOSIS_ENTRY_LIMITER) return null;
  const address = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const result = await env.DIAGNOSIS_ENTRY_LIMITER.limit({ key: `${url.pathname}:${address}` });
  if (result.success) return null;
  return new Response(JSON.stringify({ error: 'アクセスが続いています。少し時間をおいてお試しください。' }), {
    status: 429,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
