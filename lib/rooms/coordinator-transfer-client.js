/**
 * Client-safe constants + helpers for coordinator transfer LiveKit data handoff.
 * Topic string must match COORDINATOR_TRANSFER_DATA_TOPIC in lib/rooms/policy.js.
 */

export const COORDINATOR_TRANSFER_DATA_TOPIC = 'coordinator_transfer';

export const COORDINATOR_TRANSFER_HANDOFF_EVENT = 'lkr:coordinator-transfer-handoff';

/**
 * @param {{ claimToken: string, slug: string, expiresAt: string, targetIdentity: string }} payload
 */
export function encodeCoordinatorTransferPayload(payload) {
  return new TextEncoder().encode(JSON.stringify({
    type: COORDINATOR_TRANSFER_DATA_TOPIC,
    claimToken: payload.claimToken,
    slug: payload.slug,
    expiresAt: payload.expiresAt,
    targetIdentity: payload.targetIdentity,
  }));
}

/**
 * @param {Uint8Array | ArrayBuffer | string} data
 * @returns {{ claimToken: string, slug: string, expiresAt: string, targetIdentity?: string } | null}
 */
export function parseCoordinatorTransferPayload(data) {
  try {
    let text;
    if (typeof data === 'string') {
      text = data;
    } else if (data instanceof ArrayBuffer) {
      text = new TextDecoder().decode(new Uint8Array(data));
    } else if (data && typeof data === 'object' && typeof data.length === 'number') {
      text = new TextDecoder().decode(data);
    } else {
      return null;
    }
    const parsed = JSON.parse(text);
    if (!parsed || parsed.type !== COORDINATOR_TRANSFER_DATA_TOPIC) return null;
    if (typeof parsed.claimToken !== 'string' || typeof parsed.slug !== 'string') return null;
    return {
      claimToken: parsed.claimToken,
      slug: parsed.slug,
      expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : '',
      targetIdentity: typeof parsed.targetIdentity === 'string' ? parsed.targetIdentity : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Publish a reliable LiveKit data packet to the assignee.
 * @param {import('livekit-client').LocalParticipant} localParticipant
 * @param {{ claimToken: string, slug: string, expiresAt: string, targetIdentity: string }} payload
 */
export async function publishCoordinatorTransfer(localParticipant, payload) {
  if (!localParticipant || typeof localParticipant.publishData !== 'function') {
    throw new Error('LiveKit local participant is not available.');
  }
  const bytes = encodeCoordinatorTransferPayload(payload);
  await localParticipant.publishData(bytes, {
    reliable: true,
    destinationIdentities: [payload.targetIdentity],
    topic: COORDINATOR_TRANSFER_DATA_TOPIC,
  });
}
