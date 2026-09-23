import { transferCoordinator } from '../../../../../lib/rooms/coordinator-transfer.js';
import { ModerationError } from '../../../../../lib/rooms/moderation.js';
import {
  withOwnerModeration,
  jsonOk,
  jsonError,
  readJsonBody,
} from '../../../../../lib/rooms/moderation-http.js';
import { createRoomRepository } from '../../../../../lib/rooms/repository.js';

export const dynamic = 'force-dynamic';

/**
 * POST /api/rooms/[slug]/transfer-coordinator
 * Current coordinator initiates handoff to a connected LiveKit participant.
 */
export async function POST(request, { params }) {
  return withOwnerModeration(request, params, async ({
    room,
    ownerId,
    livekitCredentials,
  }) => {
    const body = (await readJsonBody(request)) || {};

    if (Object.prototype.hasOwnProperty.call(body, 'ownerId')
      || Object.prototype.hasOwnProperty.call(body, 'owner_id')) {
      return jsonError('ownerId cannot be supplied by the client.', 400, {
        code: 'OWNER_ID_FORBIDDEN',
      });
    }

    const identity = body.identity || body.participantIdentity;

    try {
      const result = await transferCoordinator({
        room,
        ownerId,
        participantIdentity: identity,
        repository: createRoomRepository(),
        livekitCredentials,
      });

      return jsonOk({
        claimToken: result.claimToken,
        expiresAt: result.expiresAt,
        targetIdentity: result.targetIdentity,
      });
    } catch (error) {
      if (error instanceof ModerationError) {
        return jsonError(error.message, error.httpStatus, { code: error.code });
      }
      throw error;
    }
  });
}
