import { listRoomParticipants, ModerationError } from '../../../../../lib/rooms/moderation.js';

import {

  withOwnerModeration,

  jsonOk,

  jsonError,

} from '../../../../../lib/rooms/moderation-http.js';

import { createRoomRepository } from '../../../../../lib/rooms/repository.js';



export const dynamic = 'force-dynamic';



/**

 * GET /api/rooms/[slug]/participants — owner-only LiveKit participant list.

 */

export async function GET(request, { params }) {

  return withOwnerModeration(request, params, async ({

    room,

    livekitCredentials,

  }) => {

    try {

      const result = await listRoomParticipants({

        room,

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

  });

}

