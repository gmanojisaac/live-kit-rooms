/**

 * Shared HTTP helpers for owner moderation route handlers.

 */



import { NextResponse } from 'next/server';

import { getServerConfig } from '../config/env.js';

import { requireRoomOwner, OwnerAuthError } from '../rooms/owner-auth.js';

import { ModerationError } from '../rooms/moderation.js';

import { createRoomRepository } from '../rooms/repository.js';

import { resolveRoomStatus } from '../rooms/status.js';

import { redactForLog } from '../security/redact.js';

import { verifyModeratorActionToken } from '../security/room-role-token.js';



export function jsonError(message, status, extra = {}) {

  return NextResponse.json({ error: message, ...extra }, {

    status,

    headers: { 'Cache-Control': 'no-store' },

  });

}



export function jsonOk(body, status = 200) {

  return NextResponse.json(body, {

    status,

    headers: { 'Cache-Control': 'no-store' },

  });

}



export async function withOwnerModeration(request, params, handler, options = {}) {

  let config;

  try {

    config = getServerConfig();

  } catch (error) {

    return jsonError(error.message || 'Server configuration error.', 503);

  }



  const slug = params?.slug;

  try {

    let auth = null;

    const moderatorToken = request.headers.get('x-lkr-moderator-token');

    if (options.requireModeratorToken || (options.allowModeratorToken && moderatorToken)) {

      const repository = createRoomRepository({ env: process.env });

      const room = await repository.getRoomBySlug(slug);

      if (!room) {

        throw new OwnerAuthError('Room not found.', {

          httpStatus: 404,

          code: 'ROOM_NOT_FOUND',

        });

      }

      const verified = verifyModeratorActionToken(moderatorToken, {

        secret: config.roomPolicy.ownerSessionSecret,

        ownerId: room.owner_id,

        roomId: room.id,

        slug: room.slug,

      });

      if (!verified) {

        throw new OwnerAuthError('Admin authorization required.', {

          httpStatus: 403,

          code: 'MODERATOR_TOKEN_REQUIRED',

        });

      }

      auth = {

        ownerId: room.owner_id,

        actorIdentity: verified.participantIdentity,

        room,

        status: resolveRoomStatus(room),

      };

    } else {

      auth = await requireRoomOwner(request, slug, {

        policy: config.roomPolicy,

        env: process.env,

      });

    }



    return await handler({

      request,

      slug,

      config,

      ownerId: auth.ownerId,

      actorIdentity: auth.actorIdentity || auth.ownerId,

      room: auth.room,

      status: auth.status,

      livekitCredentials: {

        url: config.livekitUrl,

        apiKey: config.livekitApiKey,

        apiSecret: config.livekitApiSecret,

      },

    });

  } catch (error) {

    if (error instanceof OwnerAuthError || error instanceof ModerationError) {

      return jsonError(error.message, error.httpStatus, { code: error.code });

    }

    console.error('owner_moderation_failed', redactForLog({

      message: error?.message,

      code: error?.code,

      slug,

    }));

    return jsonError('Unable to complete owner action.', 500);

  }

}



export async function readJsonBody(request) {

  try {

    return await request.json();

  } catch {

    return null;

  }

}
