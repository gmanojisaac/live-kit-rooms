import { NextResponse } from 'next/server';
import { getRunStore } from '../../../../../../../lib/runs/singleton.js';
import { createRoomRepository } from '../../../../../../../lib/rooms/repository.js';
import { getRoomBySlug } from '../../../../../../../lib/rooms/lookup.js';
import { redactForLog } from '../../../../../../../lib/security/redact.js';

export const dynamic = 'force-dynamic';

/**
 * GET /api/rooms/[slug]/runs/[runId]/image — JPEG bytes for a manual run result.
 */
export async function GET(_request, { params }) {
  const slug = params?.slug;
  const runId = params?.runId;
  if (!slug || !runId) {
    return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
  }

  try {
    const room = await getRoomBySlug(slug, { repository: createRoomRepository() });
    if (!room.ok) {
      return NextResponse.json({ error: 'Room not found.' }, { status: 404 });
    }
    const jpeg = await getRunStore().exclusive(() => getRunStore().getJpeg(slug, runId));
    if (!jpeg) {
      return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
    }
    return new NextResponse(jpeg, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store',
        'Content-Length': String(jpeg.length),
      },
    });
  } catch (error) {
    console.error('run_image_failed', redactForLog({ message: error?.message, slug, runId }));
    return NextResponse.json({ error: 'Could not load run image.' }, { status: 500 });
  }
}
