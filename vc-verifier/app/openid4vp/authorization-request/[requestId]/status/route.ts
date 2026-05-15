import { NextResponse } from 'next/server';
import { getRequestStatus } from '../../../../../src/verifier-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ requestId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { requestId } = await context.params;
  const result = getRequestStatus(requestId);
  return NextResponse.json(result.body, { status: result.status });
}
