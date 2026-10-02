import { NextResponse } from 'next/server';
import { getRunImage, RunError } from '../../../../../../../lib/runs/service.js';
import { redactForLog } from '../../../../../../../lib/security/redact.js';

export const dynamic = 'force-dynamic';

/**
 * GET /api/rooms/[slug]/runs/[runId]/image — JPEG bytes for a work-log entry.
 */
export async function GET(_request, { params }) {
  const slug = params?.slug;
  const runId = params?.runId;
  if (!slug || !runId) {
    return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
  }

  try {
    const jpeg = await getRunImage({ slug, runId });
    return new NextResponse(jpeg, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store',
        'Content-Length': String(jpeg.length),
      },
    });
  } catch (error) {
    if (error instanceof RunError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    console.error('run_image_failed', redactForLog({ message: error?.message, slug, runId }));
    return NextResponse.json({ error: 'Could not load run image.' }, { status: 500 });
  }
}
