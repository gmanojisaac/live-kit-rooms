/**

 * Audit event type constants for owner moderation (AUTH-05).

 * Metadata must never include secrets, tokens, codes, JWTs, or prompt contents.

 */



export const AUDIT_EVENT = Object.freeze({

  ROOM_CREATED: 'room_created',

  INVITE_CREATED: 'invite_created',

  PARTICIPANT_JOINED: 'participant_joined',

  PROMPT_LOCKED: 'prompt_locked',

  PROMPT_UNLOCKED: 'prompt_unlocked',

  PARTICIPANT_REMOVED: 'participant_removed',

  PARTICIPANT_ADMIN_GRANTED: 'participant_admin_granted',

  INVITATION_REVOKED: 'invitation_revoked',

  ROOM_ENDED: 'room_ended',

  ROOM_EXPIRED: 'room_expired',

  PROMPT_VERSION_CREATED: 'prompt_version_created',

});
