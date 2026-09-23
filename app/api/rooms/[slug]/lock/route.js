import { setPromptLock, ModerationError } from '../../../../../lib/rooms/moderation.js';

import {

  withOwnerModeration,

  jsonOk,

  jsonError,

  readJsonBody,

} from '../../../../../lib/rooms/moderation-http.js';

import { createRoomRepository } from '../../../../../lib/rooms/repository.js';



export const dynamic = 'force-dynamic';



/**

 * POST /api/rooms/[slug]/lock

 * Body: { locked: true | false }

 */

export async function POST(request, { params }) {

  return withOwnerModeration(request, params, async ({ room, ownerId }) => {

    const body = await readJsonBody(request);

    if (!body || typeof body.locked !== 'boolean') {

      return jsonError('Request body must include boolean locked.', 422, {

        code: 'INVALID_PAYLOAD',

      });

    }



    // Reject client-supplied owner identity as proof.

    if (Object.prototype.hasOwnProperty.call(body, 'ownerId')

      || Object.prototype.hasOwnProperty.call(body, 'owner_id')) {

      return jsonError('ownerId cannot be supplied by the client.', 400, {

        code: 'OWNER_ID_FORBIDDEN',

      });

    }



    try {

      const result = await setPromptLock({

        room,

        ownerId,

        locked: body.locked,

        repository: createRoomRepository(),

      });

      return jsonOk({

        locked: result.locked,

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

