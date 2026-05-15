import { NextResponse } from 'next/server';
import { readRequestBody } from '../../../src/next-body';
import { handleWalletResponse } from '../../../src/verifier-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await readRequestBody(request);
  const result = await handleWalletResponse(body, request.headers.get('content-type') || '');
  return NextResponse.json(result.body, { status: result.status });
}
