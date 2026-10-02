/**
 * Client-safe LiveKit data topic for UI-only coordinator identity broadcast.
 * Informational only — never use for authorization.
 */

export const COORDINATOR_ROLE_DATA_TOPIC = 'coordinator_role';

/**
 * @param {{ coordinatorIdentity: string }} payload
 */
export function encodeCoordinatorRolePayload(payload) {
  return new TextEncoder().encode(JSON.stringify({
    type: COORDINATOR_ROLE_DATA_TOPIC,
    coordinatorIdentity: payload.coordinatorIdentity,
  }));
}

/**
 * @param {Uint8Array | ArrayBuffer | string} data
 * @returns {{ coordinatorIdentity: string } | null}
 */
export function parseCoordinatorRolePayload(data) {
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
    if (!parsed || parsed.type !== COORDINATOR_ROLE_DATA_TOPIC) return null;
    if (typeof parsed.coordinatorIdentity !== 'string' || !parsed.coordinatorIdentity.trim()) {
      return null;
    }
    return { coordinatorIdentity: parsed.coordinatorIdentity.trim() };
  } catch {
    return null;
  }
}

/**
 * @param {import('livekit-client').LocalParticipant} localParticipant
 * @param {string} coordinatorIdentity
 * @param {{ destinationIdentities?: string[] }} [options]
 */
export async function publishCoordinatorRole(localParticipant, coordinatorIdentity, options = {}) {
  if (!localParticipant || typeof localParticipant.publishData !== 'function') {
    throw new Error('LiveKit local participant is not available.');
  }
  if (typeof coordinatorIdentity !== 'string' || !coordinatorIdentity.trim()) {
    throw new Error('coordinatorIdentity is required.');
  }
  const bytes = encodeCoordinatorRolePayload({
    coordinatorIdentity: coordinatorIdentity.trim(),
  });
  const opts = {
    reliable: true,
    topic: COORDINATOR_ROLE_DATA_TOPIC,
  };
  if (options.destinationIdentities?.length) {
    opts.destinationIdentities = options.destinationIdentities;
  }
  await localParticipant.publishData(bytes, opts);
}
