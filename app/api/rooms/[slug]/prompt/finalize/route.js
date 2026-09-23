import { NextResponse } from 'next/server';
import { finalizePrompt, PromptError } from '../../../../../../lib/prompts/service.js';
import { createRoomRepository } from '../../../../../../lib/rooms/repository.js';
import { redactForLog } from '../../../../../../lib/security/redact.js';

export const dynamic = 'force-dynamic';

/**
 * POST /api/rooms/[slug]/prompt/finalize
 * Body: { content: string, name?: string, finalizedBy?: string }
 * `content` must be the current shared Yjs prompt text.
 */
export async function POST(request, { params }) {
  const slug = params?.slug;
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    const result = await finalizePrompt({
      slug,
      content: typeof body?.content === 'string'
        ? body.content
        : (typeof body?.draft === 'string' ? body.draft : undefined),
      name: typeof body?.name === 'string' ? body.name : null,
      finalizedBy: typeof body?.finalizedBy === 'string' ? body.finalizedBy.slice(0, 80) : null,
      repository: createRoomRepository(),
    });
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof PromptError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.httpStatus, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    console.error('prompt_finalize_failed', redactForLog({ message: error?.message, slug }));
    return NextResponse.json(
      { error: 'Unable to finalize prompt.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
