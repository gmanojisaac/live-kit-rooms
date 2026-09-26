import { NextResponse } from 'next/server';
import { getServerConfig } from '../../../lib/config/env.js';
import { createRoom, RoomCreationError, stripInternalCreateResult } from '../../../lib/rooms/service.js';
import {
  createRateLimiter,
} from '../../../lib/security/rate-limit.js';
import { ownerSessionCookieOptions } from '../../../lib/security/owner-session.js';
import { createCreatorJoinToken } from '../../../lib/security/room-role-token.js';
import { redactForLog } from '../../../lib/security/redact.js';
import {
  getOwnerSessionToken,
  getRequestBaseUrl,
  resolveClientIp,
} from '../../../lib/http/request.js';

export const dynamic = 'force-dynamic';

/** Best-effort process-local limiter (not cross-isolate on Vercel). */
let roomCreationLimiter;

function getRoomCreationLimiter(policy, now = Date.now) {
  if (!roomCreationLimiter) {
    roomCreationLimiter = createRateLimiter({
      maxFailures: policy.roomCreationMaxAttempts,
      windowMs: policy.roomCreationWindowMs,
      now,
    });
  }
  return roomCreationLimiter;
}

function jsonError(message, status, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * GET — list endpoint reserved; collection listing is not part of this phase.
 */
export async function GET() {
  return NextResponse.json({
    status: 'not_implemented',
    message: 'Room listing is not available. Create a room with POST /api/rooms.',
  }, { status: 501 });
}

/**
 * POST /api/rooms — dynamic room creation (AUTH-01) + invitation (AUTH-02).
 */
export async function POST(request) {
  let config;
  try {
    config = getServerConfig();
  } catch (error) {
    return jsonError(error.message || 'Server configuration error.', 503);
  }

  const policy = config.roomPolicy;
  const ip = resolveClientIp(request);
  const limiter = getRoomCreationLimiter(policy);
  const limited = limiter.check(ip);
  if (limited.limited) {
    const response = jsonError('Too many room creation attempts. Please try again later.', 429);
    response.headers.set('Retry-After', String(limited.retryAfterSeconds));
    return response;
  }

  let body;
  try {
    body = await request.json();
  } catch {
    limiter.recordFailure(ip);
    return jsonError('Request body must be JSON.', 400);
  }

  // Never accept client-supplied owner_id.
  if (body && Object.prototype.hasOwnProperty.call(body, 'owner_id')) {
    limiter.recordFailure(ip);
    return jsonError('owner_id cannot be supplied by the client.', 400);
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'ownerId')) {
    limiter.recordFailure(ip);
    return jsonError('ownerId cannot be supplied by the client.', 400);
  }

  const title = body?.title;
  const accessCode = body?.accessCode;
  const expiresAt = body?.expiresAt;
  const creationSecretProvided = request.headers.get('x-room-creation-secret')
    || body?.creationSecret
    || '';

  try {
    const result = await createRoom({
      title,
      accessCode,
      expiresAt,
      baseUrl: getRequestBaseUrl(request, config.appBaseUrl),
      existingSessionToken: getOwnerSessionToken(request),
      creationSecretProvided,
      policy,
      env: process.env,
    });

    const { publicResult, sessionCookie } = stripInternalCreateResult(result);
    const ownerJoinToken = createCreatorJoinToken({
      secret: policy.ownerSessionSecret,
      ownerId: result.owner.id,
      roomId: result.room.id,
      slug: result.room.slug,
    });
    const response = NextResponse.json({
      room: publicResult.room,
      invitationUrl: publicResult.invitationUrl,
      accessCode: publicResult.accessCode,
      owner: publicResult.owner,
      ownerJoinToken,
    });
    response.headers.set('Cache-Control', 'no-store');

    if (sessionCookie) {
      response.cookies.set(
        sessionCookie.name,
        sessionCookie.value,
        ownerSessionCookieOptions({
          isProduction: config.isProduction,
          maxAgeSeconds: sessionCookie.maxAgeSeconds,
        }),
      );
    }

    return response;
  } catch (error) {
    if (error instanceof RoomCreationError) {
      // Count client/auth failures toward the creation abuse budget; not 5xx config errors.
      if (error.httpStatus === 400 || error.httpStatus === 401) {
        limiter.recordFailure(ip);
      }
      return jsonError(error.message, error.httpStatus, { code: error.code });
    }

    // Avoid logging secrets / invitation URLs.
    console.error('room_create_failed', redactForLog({
      message: error?.message,
      code: error?.code,
    }));
    limiter.recordFailure(ip);
    return jsonError('Unable to create room.', 500);
  }
}
