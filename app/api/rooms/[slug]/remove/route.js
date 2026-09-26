import { removeRoomParticipant, ModerationError } from '../../../../../lib/rooms/moderation.js';

import {

  withOwnerModeration,

  jsonOk,

  jsonError,

  readJsonBody,

} from '../../../../../lib/rooms/moderation-http.js';

import { createRoomRepository } from '../../../../../lib/rooms/repository.js';



export const dynamic = 'force-dynamic';



/**

 * POST /api/rooms/[slug]/remove

 * Body: { participantIdentity: "..." }

 */

export async function POST(request, { params }) {

  return withOwnerModeration(request, params, async ({

    room,

    ownerId,

    livekitCredentials,

  }) => {

    const body = await readJsonBody(request);

    if (!body) {

      return jsonError('Request body must be JSON.', 422, { code: 'INVALID_JSON' });

    }

    if (Object.prototype.hasOwnProperty.call(body, 'ownerId')

      || Object.prototype.hasOwnProperty.call(body, 'owner_id')) {

      return jsonError('ownerId cannot be supplied by the client.', 400, {

        code: 'OWNER_ID_FORBIDDEN',

      });

    }



    try {

      const result = await removeRoomParticipant({

        room,

        ownerId,

        participantIdentity: body.participantIdentity,

        repository: createRoomRepository(),

        livekitCredentials,

      });

      return jsonOk(result);

    } catch (error) {

      if (error instanceof ModerationError) {

        return jsonError(error.message, error.httpStatus, { code: error.code });

      }

      throw error;

    }

  }, { requireModeratorToken: true });

}
