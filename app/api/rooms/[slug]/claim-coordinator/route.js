import { NextResponse } from 'next/server';
import { getServerConfig } from '../../../../../lib/config/env.js';
import { claimCoordinator } from '../../../../../lib/rooms/coordinator-transfer.js';
import { ModerationError } from '../../../../../lib/rooms/moderation.js';
import { createRoomRepository } from '../../../../../lib/rooms/repository.js';
import { ownerSessionCookieOptions } from '../../../../../lib/security/owner-session.js';
import { redactForLog } from '../../../../../lib/security/redact.js';
import { isValidRoomSlug } from '../../../../../lib/rooms/slug.js';

export const dynamic = 'force-dynamic';

function jsonError(message, status, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * POST /api/rooms/[slug]/claim-coordinator
 * Assignee claims a pending transfer using claimToken + LiveKit identity.
 * Sets the owner-session cookie for the new coordinator.
 */
export async function POST(request, { params }) {
  let config;
  try {
    config = getServerConfig();
  } catch (error) {
    return jsonError(error.message || 'Server configuration error.', 503);
  }

  const slug = params?.slug;
  if (!isValidRoomSlug(slug)) {
    return jsonError('Room not found.', 404, { code: 'ROOM_NOT_FOUND' });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Request body must be JSON.', 400);
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, 'ownerId')
    || Object.prototype.hasOwnProperty.call(body || {}, 'owner_id')) {
    return jsonError('ownerId cannot be supplied by the client.', 400, {
      code: 'OWNER_ID_FORBIDDEN',
    });
  }

  const claimToken = body?.claimToken;
  const identity = body?.identity || body?.participantIdentity;

  try {
    const result = await claimCoordinator({
      roomSlug: slug,
      claimToken,
      participantIdentity: identity,
      repository: createRoomRepository(),
      policy: config.roomPolicy,
    });

    const response = NextResponse.json({
      ok: true,
      isCoordinator: true,
      isOwner: true,
      roomStatus: result.roomStatus,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });

    response.cookies.set(
      result.sessionCookie.name,
      result.sessionCookie.value,
      ownerSessionCookieOptions({
        isProduction: config.isProduction,
        maxAgeSeconds: result.sessionCookie.maxAgeSeconds,
      }),
    );

    return response;
  } catch (error) {
    if (error instanceof ModerationError) {
      return jsonError(error.message, error.httpStatus, { code: error.code });
    }
    console.error('claim_coordinator_failed', redactForLog({
      message: error?.message,
      code: error?.code,
      slug,
    }));
    return jsonError('Unable to claim coordinator role.', 500);
  }
}
