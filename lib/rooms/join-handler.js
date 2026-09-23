/**
 * HTTP join handler (framework-agnostic) for POST /api/rooms/[slug]/join.
 * The Next.js route wraps this with NextResponse.
 */

import { getServerConfig } from '../config/env.js';
import {
  joinRoomAsParticipant,
  RoomJoinError,
  isAuthFailureReason,
} from './join.js';
import { createJoinRateLimiter } from '../security/rate-limit.js';
import { redactForLog } from '../security/redact.js';
import { resolveClientIp } from '../http/request.js';

/** Best-effort process-local join limiter (not cross-isolate on Vercel). */
let joinLimiter;

function getJoinLimiter(policy, now = Date.now) {
  if (!joinLimiter) {
    joinLimiter = createJoinRateLimiter({
      maxFailures: policy.joinMaxFailures,
      windowMs: policy.joinWindowMs,
      now,
    });
  }
  return joinLimiter;
}

/** Test-only: reset process-local limiter between unit tests. */
export function __resetJoinLimiterForTests() {
  joinLimiter = undefined;
}

function jsonBody(message, extra = {}) {
  return { error: message, ...extra };
}

/**
 * @returns {Promise<{ status: number, body: object, headers: Record<string, string> }>}
 */
export async function handleJoinPost(request, { params }, deps = {}) {
  const headers = { 'Cache-Control': 'no-store' };

  let config;
  try {
    config = deps.config || getServerConfig(deps.env || process.env);
  } catch (error) {
    return {
      status: 503,
      body: jsonBody(error.message || 'Server configuration error.'),
      headers,
    };
  }

  if (!config.livekitUrl || !config.livekitApiKey || !config.livekitApiSecret) {
    return {
      status: 503,
      body: jsonBody('LiveKit is not configured.', { code: 'LIVEKIT_UNCONFIGURED' }),
      headers,
    };
  }

  const policy = config.roomPolicy;
  const ip = deps.resolveClientIp
    ? deps.resolveClientIp(request)
    : resolveClientIp(request, deps.env || process.env);
  const limiter = deps.limiter || getJoinLimiter(policy, deps.now);
  const limited = limiter.check(ip);
  if (limited.limited) {
    return {
      status: 429,
      body: jsonBody('Too many attempts. Please try again later.', { code: 'RATE_LIMITED' }),
      headers: {
        ...headers,
        'Retry-After': String(limited.retryAfterSeconds),
      },
    };
  }

  const slug = params?.slug;

  let body;
  try {
    body = await request.json();
  } catch {
    limiter.recordFailure(ip);
    return {
      status: 400,
      body: jsonBody('Request body must be JSON.', { code: 'INVALID_JSON' }),
      headers,
    };
  }

  const inviteToken = body?.inviteToken ?? body?.invite;
  const displayName = body?.displayName ?? body?.name;
  const accessCode = body?.accessCode;

  try {
    const result = await (deps.joinRoomAsParticipant || joinRoomAsParticipant)({
      slug,
      inviteToken,
      displayName,
      accessCode,
      identity: body?.identity,
      roomName: body?.roomName || body?.room,
      policy,
      repository: deps.repository,
      livekitRooms: deps.livekitRooms,
      livekitCredentials: deps.livekitCredentials || {
        url: config.livekitUrl,
        apiKey: config.livekitApiKey,
        apiSecret: config.livekitApiSecret,
      },
      now: deps.now,
    });

    return {
      status: 200,
      body: {
        token: result.token,
        livekitUrl: result.livekitUrl,
        room: result.room,
        participant: result.participant,
      },
      headers,
    };
  } catch (error) {
    if (error instanceof RoomJoinError) {
      const countsTowardLimit = error.httpStatus === 400
        || error.httpStatus === 403
        || isAuthFailureReason(error.code);
      if (countsTowardLimit) {
        limiter.recordFailure(ip);
      }

      const responseHeaders = { ...headers };
      if (error.retryAfterSeconds) {
        responseHeaders['Retry-After'] = String(error.retryAfterSeconds);
      }
      return {
        status: error.httpStatus,
        body: jsonBody(error.message, { code: error.code }),
        headers: responseHeaders,
      };
    }

    console.error('room_join_failed', redactForLog({
      message: error?.message,
      code: error?.code,
      slug,
    }));
    limiter.recordFailure(ip);
    return {
      status: 500,
      body: jsonBody('Unable to join room.'),
      headers,
    };
  }
}
