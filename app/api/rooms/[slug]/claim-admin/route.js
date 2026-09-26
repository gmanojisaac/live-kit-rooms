import { NextResponse } from 'next/server';
import { getServerConfig } from '../../../../../lib/config/env.js';
import { createLiveKitRoomService } from '../../../../../lib/livekit/rooms.js';
import { verifyParticipantAccessToken } from '../../../../../lib/livekit/token.js';
import { createRoomRepository } from '../../../../../lib/rooms/repository.js';
import { createModeratorActionToken } from '../../../../../lib/security/room-role-token.js';
import { redactForLog } from '../../../../../lib/security/redact.js';

export const dynamic = 'force-dynamic';

function jsonError(message, status, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function jsonOk(body) {
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

function parseMetadata(metadata) {
  if (typeof metadata !== 'string' || !metadata) return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * POST /api/rooms/[slug]/claim-admin
 * Body: { participantIdentity: "...", token: "livekit-jwt" }
 */
export async function POST(request, { params }) {
  let config;
  try {
    config = getServerConfig();
  } catch (error) {
    return jsonError(error.message || 'Server configuration error.', 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Request body must be JSON.', 422, { code: 'INVALID_JSON' });
  }

  const participantIdentity = typeof body?.participantIdentity === 'string'
    ? body.participantIdentity.trim()
    : '';
  const token = typeof body?.token === 'string' ? body.token : '';
  if (!participantIdentity || !token) {
    return jsonError('participantIdentity and token are required.', 422, {
      code: 'INVALID_PAYLOAD',
    });
  }

  try {
    const repository = createRoomRepository();
    const room = await repository.getRoomBySlug(params?.slug);
    if (!room) {
      return jsonError('Room not found.', 404, { code: 'ROOM_NOT_FOUND' });
    }

    const claims = await verifyParticipantAccessToken(token, {
      apiKey: config.livekitApiKey,
      apiSecret: config.livekitApiSecret,
    });
    if (
      claims?.sub !== participantIdentity
      || claims?.video?.room !== room.slug
      || claims?.video?.roomJoin !== true
    ) {
      return jsonError('Admin claim token does not match this participant.', 403, {
        code: 'ADMIN_CLAIM_FORBIDDEN',
      });
    }

    const roomsApi = createLiveKitRoomService({
      url: config.livekitUrl,
      apiKey: config.livekitApiKey,
      apiSecret: config.livekitApiSecret,
      maxParticipants: config.roomPolicy.maxParticipants,
    });
    const participants = await roomsApi.listParticipants(room.slug);
    const participant = participants.find((p) => p?.identity === participantIdentity);
    if (!participant) {
      return jsonError('Participant not found in this room.', 404, {
        code: 'PARTICIPANT_NOT_FOUND',
      });
    }

    const metadata = parseMetadata(participant.metadata);
    if (metadata.role !== 'admin') {
      return jsonError('Participant is not an admin.', 403, {
        code: 'ADMIN_CLAIM_FORBIDDEN',
      });
    }

    return jsonOk({
      moderatorToken: createModeratorActionToken({
        secret: config.roomPolicy.ownerSessionSecret,
        ownerId: room.owner_id,
        roomId: room.id,
        slug: room.slug,
        participantIdentity,
        expiresAt: room.expires_at,
      }),
    });
  } catch (error) {
    console.error('admin_claim_failed', redactForLog({
      message: error?.message,
      code: error?.code,
      slug: params?.slug,
    }));
    return jsonError('Unable to claim admin permissions.', 500);
  }
}
