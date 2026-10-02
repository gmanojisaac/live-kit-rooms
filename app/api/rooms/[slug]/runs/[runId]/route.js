import { NextResponse } from 'next/server';
import { getRun, RunError } from '../../../../../../lib/runs/service.js';
import { redactForLog } from '../../../../../../lib/security/redact.js';

export const dynamic = 'force-dynamic';

/**
 * GET /api/rooms/[slug]/runs/[runId]
 */
export async function GET(_request, { params }) {
  const slug = params?.slug;
  const runId = params?.runId;
  if (!slug || !runId) {
    return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
  }

  try {
    const run = await getRun({ slug, runId });
    return NextResponse.json(run, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof RunError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    console.error('run_get_failed', redactForLog({ message: error?.message, slug, runId }));
    return NextResponse.json({ error: 'Could not load run.' }, { status: 500 });
  }
}
