import { revokeRoomInvitation, ModerationError } from '../../../../../lib/rooms/moderation.js';

import {

  withOwnerModeration,

  jsonOk,

  jsonError,

  readJsonBody,

} from '../../../../../lib/rooms/moderation-http.js';

import { createRoomRepository } from '../../../../../lib/rooms/repository.js';



export const dynamic = 'force-dynamic';



/**

 * POST /api/rooms/[slug]/revoke-invite

 * Body (optional): { inviteId?: string }

 * Without inviteId, revokes all active invitations for the room.

 */

export async function POST(request, { params }) {

  return withOwnerModeration(request, params, async ({ room, ownerId }) => {

    const body = (await readJsonBody(request)) || {};

    if (Object.prototype.hasOwnProperty.call(body, 'ownerId')

      || Object.prototype.hasOwnProperty.call(body, 'owner_id')) {

      return jsonError('ownerId cannot be supplied by the client.', 400, {

        code: 'OWNER_ID_FORBIDDEN',

      });

    }



    try {

      const result = await revokeRoomInvitation({

        room,

        ownerId,

        inviteId: body.inviteId || null,

        repository: createRoomRepository(),

      });

      return jsonOk({

        revoked: result.revoked,

        alreadyRevoked: result.alreadyRevoked,

        invitations: result.invitations,

        roomStatus: result.roomStatus,

      });

    } catch (error) {

      if (error instanceof ModerationError) {

        return jsonError(error.message, error.httpStatus, { code: error.code });

      }

      throw error;

    }

  });

}

