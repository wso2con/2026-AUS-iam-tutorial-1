import { NextResponse } from 'next/server';
import { readRequestBody } from '../../../../src/next-body';
import { getRequestObjectJwt } from '../../../../src/verifier-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ requestId: string }>;
}

async function serveRequestObject(request: Request, context: RouteContext, method: 'GET' | 'POST') {
  const { requestId } = await context.params;
  const body = method === 'POST' ? await readRequestBody(request) : {};
  const result = await getRequestObjectJwt(
    requestId,
    method,
    request.headers.get('content-type') || '',
    body
  );

  if ('jwt' in result && result.jwt) {
    return new Response(result.jwt, {
      status: result.status,
      headers: {
        'Content-Type': 'application/oauth-authz-req+jwt',
        'Cache-Control': 'no-store'
      }
    });
  }

  return NextResponse.json(result.body, { status: result.status });
}

export function GET(request: Request, context: RouteContext) {
  return serveRequestObject(request, context, 'GET');
}

export function POST(request: Request, context: RouteContext) {
  return serveRequestObject(request, context, 'POST');
}
