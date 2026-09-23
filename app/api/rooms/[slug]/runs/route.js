import { NextResponse } from 'next/server';
import { getRunStore } from '../../../../../lib/runs/singleton.js';
import { decodeJpegBase64 } from '../../../../../lib/jpeg.js';
import { createRoomRepository } from '../../../../../lib/rooms/repository.js';
import { getRoomBySlug } from '../../../../../lib/rooms/lookup.js';
import { getPromptVersion, PromptError } from '../../../../../lib/prompts/service.js';
import { redactForLog } from '../../../../../lib/security/redact.js';

export const dynamic = 'force-dynamic';

function jsonError(message, status, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function assertRoomExists(slug) {
  const result = await getRoomBySlug(slug, { repository: createRoomRepository() });
  if (!result.ok) {
    throw new PromptError('Room not found.', { httpStatus: 404, code: 'ROOM_NOT_FOUND' });
  }
  return result.room;
}

/**
 * GET /api/rooms/[slug]/runs
 */
export async function GET(_request, { params }) {
  const slug = params?.slug;
  if (!slug) return jsonError('Room not found.', 404);

  try {
    await assertRoomExists(slug);
    const runs = await getRunStore().exclusive(() => getRunStore().list(slug));
    return NextResponse.json({ runs }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof PromptError) {
      return jsonError(error.message, error.httpStatus, { code: error.code });
    }
    console.error('runs_list_failed', redactForLog({ message: error?.message, slug }));
    return jsonError('Could not load run history.', 500);
  }
}

/**
 * POST /api/rooms/[slug]/runs
 * Body: { promptVersion, status, notes?, jpegBase64|jpeg, contentType?, executedBy? }
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

  const promptVersion = Number(body?.promptVersion ?? body?.version);
  if (!Number.isInteger(promptVersion) || promptVersion < 1) {
    return jsonError('Select a finalized prompt version.', 422, { code: 'INVALID_VERSION' });
  }

  const status = body?.status === 'failure' ? 'failure' : body?.status === 'success' ? 'success' : null;
  if (!status) {
    return jsonError('Status must be success or failure.', 422, { code: 'INVALID_STATUS' });
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
    await assertRoomExists(slug);
    const versionEntry = await getPromptVersion({
      slug,
      version: promptVersion,
      repository: createRoomRepository(),
    });

    const executedBy = typeof body?.executedBy === 'string'
      ? body.executedBy.trim().slice(0, 80)
      : 'Participant';
    const notes = typeof body?.notes === 'string' ? body.notes : '';

    const run = await getRunStore().exclusive(() => getRunStore().create(slug, {
      promptVersion,
      promptSnapshot: versionEntry.prompt || '',
      executedBy: executedBy || 'Participant',
      status,
      notes,
      jpeg,
    }));

    return NextResponse.json(run, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof PromptError) {
      return jsonError(error.message, error.httpStatus, { code: error.code });
    }
    if (['INVALID_STATUS', 'INVALID_NOTES', 'NOTES_TOO_LONG', 'MISSING_JPEG'].includes(error?.code)) {
      return jsonError(error.message, 422, { code: error.code });
    }
    console.error('runs_create_failed', redactForLog({ message: error?.message, slug }));
    return jsonError('Could not save run.', 500);
  }
}
