import { NextResponse } from 'next/server';
import { getSession } from '../../../../src/verifier-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const result = getSession(sessionId);
  return NextResponse.json(result.body, { status: result.status });
}
