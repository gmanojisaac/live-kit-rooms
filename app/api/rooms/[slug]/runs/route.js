import { NextResponse } from 'next/server';
import { createRun, listRuns, RunError } from '../../../../../lib/runs/service.js';
import { decodeJpegBase64 } from '../../../../../lib/jpeg.js';
import { getRoomPolicy } from '../../../../../lib/rooms/policy.js';
import { redactForLog } from '../../../../../lib/security/redact.js';

export const dynamic = 'force-dynamic';

function jsonError(message, status, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * GET /api/rooms/[slug]/runs?by=<name>
 * Work-log entries (newest first) plus the configured team roster for the user filter.
 */
export async function GET(request, { params }) {
  const slug = params?.slug;
  if (!slug) return jsonError('Room not found.', 404);

  try {
    const executedBy = new URL(request.url).searchParams.get('by');
    const runs = await listRuns({ slug, executedBy });
    return NextResponse.json(
      { runs, teamMembers: getRoomPolicy().teamMembers },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof RunError) {
      return jsonError(error.message, error.httpStatus, { code: error.code });
    }
    console.error('runs_list_failed', redactForLog({ message: error?.message, slug }));
    return jsonError('Could not load run history.', 500);
  }
}

/**
 * POST /api/rooms/[slug]/runs
 * Body: { kind?: 'run'|'progress', promptVersion?, status?, notes?, jpegBase64|jpeg, contentType?, executedBy? }
 */
export async function POST(request, { params }) {
  const slug = params?.slug;
  if (!slug) return jsonError('Room not found.', 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Request body must be JSON.', 400, { code: 'INVALID_JSON' });
  }

  let jpeg;
  try {
    jpeg = decodeJpegBase64(body?.jpegBase64 ?? body?.jpeg, {
      contentType: body?.contentType,
    });
  } catch (error) {
    const code = error?.code || 'INVALID_JPEG';
    const statusCode = code === 'JPEG_TOO_LARGE' ? 413 : 400;
    return jsonError(error.message || 'Invalid JPEG.', statusCode, { code });
  }

  try {
    const run = await createRun({
      slug,
      kind: body?.kind === 'progress' ? 'progress' : 'run',
      promptVersion: body?.promptVersion ?? body?.version,
      status: body?.status,
      notes: body?.notes ?? '',
      executedBy: body?.executedBy,
      jpeg,
      teamMembers: getRoomPolicy().teamMembers,
    });

    return NextResponse.json(run, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof RunError) {
      return jsonError(error.message, error.httpStatus, { code: error.code });
    }
    console.error('runs_create_failed', redactForLog({ message: error?.message, slug }));
    return jsonError('Could not save run.', 500);
  }
}
