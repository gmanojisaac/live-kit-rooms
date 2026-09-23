import { NextResponse } from 'next/server';
import { getRunStore } from '../../../../../../lib/runs/singleton.js';
import { createRoomRepository } from '../../../../../../lib/rooms/repository.js';
import { getRoomBySlug } from '../../../../../../lib/rooms/lookup.js';
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
    const room = await getRoomBySlug(slug, { repository: createRoomRepository() });
    if (!room.ok) {
      return NextResponse.json({ error: 'Room not found.' }, { status: 404 });
    }
    const run = await getRunStore().exclusive(() => getRunStore().get(slug, runId));
    if (!run) {
      return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
    }
    return NextResponse.json(run, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('run_get_failed', redactForLog({ message: error?.message, slug, runId }));
    return NextResponse.json({ error: 'Could not load run.' }, { status: 500 });
  }
}
