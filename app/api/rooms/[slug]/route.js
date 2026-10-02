import { NextResponse } from 'next/server';
import { getRoomBySlug } from '../../../../lib/rooms/lookup.js';
import { createRoomRepository } from '../../../../lib/rooms/repository.js';
import { resolveOwnerContext, ensureRoomNotStaleActive } from '../../../../lib/rooms/owner-auth.js';
import { getServerConfig } from '../../../../lib/config/env.js';
import { toPublicRoom } from '../../../../lib/rooms/status.js';
import { redactForLog } from '../../../../lib/security/redact.js';

export const dynamic = 'force-dynamic';

/**
 * GET /api/rooms/[slug] — public-safe room lookup by slug.
 * Includes isOwner when a valid owner session cookie matches rooms.owner_id.
 */
export async function GET(request, { params }) {
  const slug = params?.slug;
  try {
    const repository = createRoomRepository();
    const result = await getRoomBySlug(slug, {
      repository,
      includeSensitive: true,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: 'Room not found.' },
        { status: result.httpStatus || 404 },
      );
    }

    let config = null;
    try {
      config = getServerConfig();
    } catch {
      config = null;
    }

    await ensureRoomNotStaleActive(result.room, repository);

    const refreshed = await repository.getRoomBySlug(slug);
    const promptDoc = refreshed
      ? await repository.getPromptDocument(refreshed.id)
      : null;

    const ownerCtx = resolveOwnerContext(request, refreshed || result.room, {
      policy: config?.roomPolicy,
    });

    const publicRoom = toPublicRoom(refreshed || result.room, {
      isOwner: ownerCtx.isOwner,
      promptLocked: Boolean(promptDoc?.is_locked),
    });

    return NextResponse.json(
      {
        room: {
          ...publicRoom,
          isCoordinator: ownerCtx.isOwner,
        },
        isOwner: ownerCtx.isOwner,
        isCoordinator: ownerCtx.isOwner,
        roomStatus: publicRoom.status,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('room_lookup_failed', redactForLog({ message: error?.message }));
    return NextResponse.json({ error: 'Unable to look up room.' }, { status: 500 });
  }
}
