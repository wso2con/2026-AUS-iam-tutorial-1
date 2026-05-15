import { NextResponse } from 'next/server';
import { readJsonBody } from '../../../src/next-body';
import { createVerificationSession } from '../../../src/verifier-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const result = await createVerificationSession(body);
  return NextResponse.json(result.body, { status: result.status });
}
