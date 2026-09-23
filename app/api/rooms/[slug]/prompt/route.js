import { NextResponse } from 'next/server';
import {
  getPromptWorkspace,
  persistPromptSnapshot,
  PromptError,
} from '../../../../../lib/prompts/service.js';
import { createRoomRepository } from '../../../../../lib/rooms/repository.js';
import { redactForLog } from '../../../../../lib/security/redact.js';

export const dynamic = 'force-dynamic';

function jsonError(message, status, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * GET /api/rooms/[slug]/prompt — durable snapshot + versions.
 * While participants are connected, Yjs is the live source of truth.
 */
export async function GET(_request, { params }) {
  const slug = params?.slug;
  try {
    const repository = createRoomRepository();
    const prompt = await getPromptWorkspace({
      slug,
      repository,
    });
    return NextResponse.json({ prompt }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof PromptError) {
      return jsonError(error.message, error.httpStatus, { code: error.code });
    }
    console.error('prompt_get_failed', redactForLog({ message: error?.message, slug }));
    return jsonError('Unable to load prompt.', 500);
  }
}

/**
 * PUT /api/rooms/[slug]/prompt — debounced snapshot persistence only.
 * Does not replace Yjs collaboration; rejects when locked / ended / expired.
 *
 * Body: { content|draft: string, yjsState?: string, updatedBy?: string }
 */
export async function PUT(request, { params }) {
  const slug = params?.slug;
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Request body must be JSON.', 400, { code: 'INVALID_JSON' });
  }

  try {
    const content = typeof body?.content === 'string'
      ? body.content
      : body?.draft;

    const prompt = await persistPromptSnapshot({
      slug,
      content,
      yjsState: body?.yjsState ?? null,
      updatedBy: typeof body?.updatedBy === 'string' ? body.updatedBy.slice(0, 80) : null,
      repository: createRoomRepository(),
    });

    return NextResponse.json({
      prompt,
      mode: 'snapshot',
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof PromptError) {
      return jsonError(error.message, error.httpStatus, { code: error.code });
    }
    console.error('prompt_snapshot_failed', redactForLog({ message: error?.message, slug }));
    return jsonError('Unable to persist prompt snapshot.', 500);
  }
}
