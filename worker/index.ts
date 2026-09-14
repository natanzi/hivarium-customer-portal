export interface Env {
  PORTAL_DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
}

const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

function json(payload: unknown, status = 200): Response {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return Response.json(payload, { status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({ service: 'hivarium-customer-portal', status: 'ok' });
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'not_found' }, 404);
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
} satisfies ExportedHandler<Env>;
