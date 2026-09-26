/**

 * Room + invite + prompt + audit persistence via Supabase service role

 * (or injectable store for tests).

 */



import { createServiceRoleSupabaseClient } from '../supabase/admin.js';

import { assertServerOnly } from '../security/server-only.js';



function getGlobalMemoryRepository() {
  if (!globalThis.__memoryRoomRepository) {
    globalThis.__memoryRoomRepository = createMemoryRoomRepository();
  }
  return globalThis.__memoryRoomRepository;
}

export function createRoomRepository({ client, env } = {}) {
  assertServerOnly();

  let supabase;
  try {
    supabase = client
      || (env && env !== process.env
        ? createServiceRoleSupabaseClient(env)
        : createServiceRoleSupabaseClient());
  } catch (err) {
    if (/requires NEXT_PUBLIC_SUPABASE_URL/i.test(err?.message)) {
      return getGlobalMemoryRepository();
    }
    throw err;
  }



  return {

    async insertRoom(row) {

      const { data, error } = await supabase

        .from('rooms')

        .insert(row)

        .select('id, slug, title, owner_id, status, max_participants, expires_at, created_at, code_hash')

        .single();

      if (error) throw error;

      return data;

    },



    async insertInvite(row) {

      const { data, error } = await supabase

        .from('room_invites')

        .insert(row)

        .select('id, room_id, token_hash, expires_at, max_uses, used_count, revoked_at')

        .single();

      if (error) throw error;

      return data;

    },



    async insertAuditEvent(row) {

      const { data, error } = await supabase

        .from('audit_events')

        .insert(row)

        .select('id, room_id, event_type, actor_id, metadata_minimal, created_at')

        .single();

      if (error) throw error;

      return data;

    },



    async listAuditEvents(roomId, { limit = 50 } = {}) {

      const { data, error } = await supabase

        .from('audit_events')

        .select('id, room_id, event_type, actor_id, metadata_minimal, created_at')

        .eq('room_id', roomId)

        .order('created_at', { ascending: false })

        .limit(limit);

      if (error) throw error;

      return data || [];

    },



    async getRoomBySlug(slug) {

      const { data, error } = await supabase

        .from('rooms')

        .select('id, slug, title, owner_id, status, max_participants, expires_at, created_at, code_hash')

        .eq('slug', slug)

        .maybeSingle();

      if (error) throw error;

      return data;

    },



    async getRoomById(id) {

      const { data, error } = await supabase

        .from('rooms')

        .select('id, slug, title, owner_id, status, max_participants, expires_at, created_at, code_hash')

        .eq('id', id)

        .maybeSingle();

      if (error) throw error;

      return data;

    },



    async getInviteByTokenHash(tokenHash) {

      const { data, error } = await supabase

        .from('room_invites')

        .select('id, room_id, token_hash, expires_at, max_uses, used_count, revoked_at')

        .eq('token_hash', tokenHash)

        .maybeSingle();

      if (error) throw error;

      return data;

    },



    async getInviteById(inviteId) {

      const { data, error } = await supabase

        .from('room_invites')

        .select('id, room_id, token_hash, expires_at, max_uses, used_count, revoked_at')

        .eq('id', inviteId)

        .maybeSingle();

      if (error) throw error;

      return data;

    },



    async listInvitesForRoom(roomId) {

      const { data, error } = await supabase

        .from('room_invites')

        .select('id, room_id, token_hash, expires_at, max_uses, used_count, revoked_at')

        .eq('room_id', roomId)

        .order('id', { ascending: true });

      if (error) throw error;

      return data || [];

    },



    /**

     * Persist expired status when join-time expiry detects a stale active row.

     */

    async markRoomExpired(roomId) {

      const { data, error } = await supabase

        .from('rooms')

        .update({ status: 'expired' })

        .eq('id', roomId)

        .eq('status', 'active')

        .select('id, status')

        .maybeSingle();

      if (error) throw error;

      return data;

    },



    /**

     * End an active room. Idempotent when already ended: returns current row.

     * Never transitions expired → ended overwrite of history is allowed only from active,

     * but ending an already-ended room returns the ended row.

     */

    async markRoomEnded(roomId) {

      const { data: ended, error: endError } = await supabase

        .from('rooms')

        .update({ status: 'ended' })

        .eq('id', roomId)

        .eq('status', 'active')

        .select('id, status')

        .maybeSingle();

      if (endError) throw endError;

      if (ended) return ended;



      const { data: current, error } = await supabase

        .from('rooms')

        .select('id, status')

        .eq('id', roomId)

        .maybeSingle();

      if (error) throw error;

      return current;

    },



    /**

     * Update the privileged owner/coordinator id for a room.

     */

    async updateRoomOwnerId(roomId, ownerId) {

      const { data, error } = await supabase

        .from('rooms')

        .update({ owner_id: ownerId })

        .eq('id', roomId)

        .select('id, slug, title, owner_id, status, max_participants, expires_at, created_at, code_hash')

        .maybeSingle();

      if (error) throw error;

      return data;

    },



    async cancelPendingCoordinatorTransfers(roomId, {

      cancelledAt = new Date().toISOString(),

    } = {}) {

      const { data, error } = await supabase

        .from('room_coordinator_transfers')

        .update({ cancelled_at: cancelledAt })

        .eq('room_id', roomId)

        .is('claimed_at', null)

        .is('cancelled_at', null)

        .select('id');

      if (error) throw error;

      return data || [];

    },



    async insertCoordinatorTransfer(row) {

      const { data, error } = await supabase

        .from('room_coordinator_transfers')

        .insert(row)

        .select(

          'id, room_id, from_owner_id, to_participant_identity, new_owner_id, claim_token_hash, expires_at, claimed_at, cancelled_at, created_at',

        )

        .single();

      if (error) throw error;

      return data;

    },



    async getCoordinatorTransferByClaimHash(claimTokenHash) {

      const { data, error } = await supabase

        .from('room_coordinator_transfers')

        .select(

          'id, room_id, from_owner_id, to_participant_identity, new_owner_id, claim_token_hash, expires_at, claimed_at, cancelled_at, created_at',

        )

        .eq('claim_token_hash', claimTokenHash)

        .maybeSingle();

      if (error) throw error;

      return data;

    },



    async markCoordinatorTransferClaimed(transferId, {

      claimedAt = new Date().toISOString(),

    } = {}) {

      const { data, error } = await supabase

        .from('room_coordinator_transfers')

        .update({ claimed_at: claimedAt })

        .eq('id', transferId)

        .is('claimed_at', null)

        .is('cancelled_at', null)

        .select(

          'id, room_id, from_owner_id, to_participant_identity, new_owner_id, claim_token_hash, expires_at, claimed_at, cancelled_at, created_at',

        )

        .maybeSingle();

      if (error) throw error;

      return data;

    },



    /**

     * Revoke a specific invitation by id. Returns updated row or null if missing.

     * Scoped callers must verify room_id ownership before calling.

     */

    async revokeInviteById(inviteId, { revokedAt = new Date().toISOString() } = {}) {

      const { data, error } = await supabase

        .from('room_invites')

        .update({ revoked_at: revokedAt })

        .eq('id', inviteId)

        .is('revoked_at', null)

        .select('id, room_id, token_hash, expires_at, max_uses, used_count, revoked_at')

        .maybeSingle();

      if (error) throw error;

      if (data) return data;



      return this.getInviteById(inviteId);

    },



    /**

     * Revoke all unrevoked invitations for a room. Returns count revoked.

     */

    async revokeActiveInvitesForRoom(roomId, { revokedAt = new Date().toISOString() } = {}) {

      const { data, error } = await supabase

        .from('room_invites')

        .update({ revoked_at: revokedAt })

        .eq('room_id', roomId)

        .is('revoked_at', null)

        .select('id');

      if (error) throw error;

      return Array.isArray(data) ? data.length : 0;

    },



    async getPromptDocument(roomId) {

      const { data, error } = await supabase

        .from('prompt_documents')

        .select('room_id, latest_snapshot, revision, yjs_state, updated_by, updated_at, is_locked')

        .eq('room_id', roomId)

        .maybeSingle();

      if (error) throw error;

      return data;

    },



    async ensurePromptDocument(roomId) {

      const existing = await this.getPromptDocument(roomId);

      if (existing) return existing;

      const { data, error } = await supabase

        .from('prompt_documents')

        .insert({

          room_id: roomId,

          latest_snapshot: '',

          revision: 0,

          is_locked: false,

        })

        .select('room_id, latest_snapshot, revision, yjs_state, updated_by, updated_at, is_locked')

        .single();

      if (error) {

        // Race: another writer inserted first.

        if (error.code === '23505') return this.getPromptDocument(roomId);

        throw error;

      }

      return data;

    },



    async setPromptLocked(roomId, locked) {

      await this.ensurePromptDocument(roomId);

      const { data, error } = await supabase

        .from('prompt_documents')

        .update({

          is_locked: Boolean(locked),

          updated_at: new Date().toISOString(),

        })

        .eq('room_id', roomId)

        .select('room_id, latest_snapshot, revision, yjs_state, updated_by, updated_at, is_locked')

        .single();

      if (error) throw error;

      return data;

    },



    async updatePromptDraft(roomId, draft, updatedBy, { yjsState } = {}) {

      await this.ensurePromptDocument(roomId);

      const { data: current, error: readError } = await supabase

        .from('prompt_documents')

        .select('revision, is_locked')

        .eq('room_id', roomId)

        .single();

      if (readError) throw readError;



      const patch = {

        latest_snapshot: draft,

        revision: Number(current.revision || 0) + 1,

        updated_by: updatedBy || null,

        updated_at: new Date().toISOString(),

      };

      if (typeof yjsState === 'string') {

        patch.yjs_state = yjsState;

      }



      const { data, error } = await supabase

        .from('prompt_documents')

        .update(patch)

        .eq('room_id', roomId)

        .eq('is_locked', false)

        .select('room_id, latest_snapshot, revision, yjs_state, updated_by, updated_at, is_locked')

        .maybeSingle();

      if (error) throw error;

      return data;

    },



    async listPromptVersions(roomId) {

      const { data, error } = await supabase

        .from('prompt_versions')

        .select('id, room_id, version_number, name, content, created_by, created_at')

        .eq('room_id', roomId)

        .order('version_number', { ascending: true });

      if (error) {
        console.error('listPromptVersions_failed', {
          roomId,
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        });
        throw error;
      }

      return data || [];

    },



    async getPromptVersion(roomId, versionNumber) {

      const { data, error } = await supabase

        .from('prompt_versions')

        .select('id, room_id, version_number, name, content, created_by, created_at')

        .eq('room_id', roomId)

        .eq('version_number', versionNumber)

        .maybeSingle();

      if (error) throw error;

      return data;

    },



    async insertPromptVersion(row) {

      const { data, error } = await supabase

        .from('prompt_versions')

        .insert(row)

        .select('id, room_id, version_number, name, content, created_by, created_at')

        .single();

      if (error) throw error;

      return data;

    },



    /**

     * Atomic invite consumption. Returns updated row or null if not consumable.

     */

    async tryConsumeInvite(inviteId) {

      const { data, error } = await supabase.rpc('try_consume_room_invite', {

        invite_id: inviteId,

      });

      if (error) throw error;

      return data || null;

    },



    

    async insertParticipantRejoinGrant(row) {

      const { data, error } = await supabase

        .from('room_participant_rejoin_grants')

        .insert(row)

        .select('id, room_id, invite_id, token_hash, participant_identity, created_at, last_used_at, revoked_at')

        .single();

      if (error) throw error;

      return data;

    },



    async getParticipantRejoinGrantByTokenHash(tokenHash) {

      const { data, error } = await supabase

        .from('room_participant_rejoin_grants')

        .select('id, room_id, invite_id, token_hash, participant_identity, created_at, last_used_at, revoked_at')

        .eq('token_hash', tokenHash)

        .maybeSingle();

      if (error) throw error;

      return data;

    },



    async touchParticipantRejoinGrant(grantId, {

      participantIdentity,

      lastUsedAt = new Date().toISOString(),

    } = {}) {

      const patch = { last_used_at: lastUsedAt };

      if (typeof participantIdentity === 'string' && participantIdentity) {

        patch.participant_identity = participantIdentity;

      }

      const { data, error } = await supabase

        .from('room_participant_rejoin_grants')

        .update(patch)

        .eq('id', grantId)

        .is('revoked_at', null)

        .select('id, room_id, invite_id, token_hash, participant_identity, created_at, last_used_at, revoked_at')

        .maybeSingle();

      if (error) throw error;

      return data;

    },



    async revokeParticipantRejoinGrantByParticipantIdentity(roomId, participantIdentity, {

      revokedAt = new Date().toISOString(),

    } = {}) {

      const { data, error } = await supabase

        .from('room_participant_rejoin_grants')

        .update({ revoked_at: revokedAt })

        .eq('room_id', roomId)

        .eq('participant_identity', participantIdentity)

        .is('revoked_at', null)

        .select('id');

      if (error) throw error;

      return Array.isArray(data) ? data.length : 0;

    },



    async revokeParticipantRejoinGrantsForRoom(roomId, {

      revokedAt = new Date().toISOString(),

    } = {}) {

      const { data, error } = await supabase

        .from('room_participant_rejoin_grants')

        .update({ revoked_at: revokedAt })

        .eq('room_id', roomId)

        .is('revoked_at', null)

        .select('id');

      if (error) throw error;

      return Array.isArray(data) ? data.length : 0;

    },



    async deleteParticipantRejoinGrant(grantId) {

      const { error } = await supabase

        .from('room_participant_rejoin_grants')

        .delete()

        .eq('id', grantId);

      if (error) throw error;

    },

async deleteRoomCascade(roomId) {

      const { error } = await supabase.from('rooms').delete().eq('id', roomId);

      if (error) throw error;

    },

  };

}



/**

 * In-memory repository for unit tests (not for production).

 */

export function createMemoryRoomRepository({ now = Date.now } = {}) {

  const rooms = new Map();

  const invites = new Map();

  const prompts = new Map();

  const versions = new Map();

  const coordinatorTransfers = new Map();

  const rejoinGrants = new Map();

  const audits = [];



  return {

    rooms,

    invites,

    prompts,

    versions,

    coordinatorTransfers,

    audits,

    async insertRoom(row) {

      const id = row.id || cryptoRandomUuid();

      const record = {

        ...row,

        id,

        created_at: row.created_at || new Date(now()).toISOString(),

      };

      if ([...rooms.values()].some((r) => r.slug === record.slug)) {

        const err = new Error('duplicate slug');

        err.code = '23505';

        throw err;

      }

      rooms.set(id, record);

      return { ...record };

    },

    async insertInvite(row) {

      const id = row.id || cryptoRandomUuid();

      const record = {

        used_count: 0,

        revoked_at: null,

        ...row,

        id,

      };

      invites.set(id, record);

      return { ...record };

    },

    async insertAuditEvent(row) {

      const record = {

        id: cryptoRandomUuid(),

        ...row,

        created_at: new Date(now()).toISOString(),

      };

      audits.push(record);

      return record;

    },

    async listAuditEvents(roomId, { limit = 50 } = {}) {

      return audits

        .filter((a) => a.room_id === roomId)

        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))

        .slice(0, limit)

        .map((a) => ({ ...a }));

    },

    async getRoomBySlug(slug) {

      return [...rooms.values()].find((r) => r.slug === slug) || null;

    },

    async getRoomById(id) {

      return rooms.get(id) || null;

    },

    async getInviteByTokenHash(tokenHash) {

      return [...invites.values()].find((i) => i.token_hash === tokenHash) || null;

    },

    async getInviteById(inviteId) {

      return invites.get(inviteId) || null;

    },

    async listInvitesForRoom(roomId) {

      return [...invites.values()].filter((i) => i.room_id === roomId);

    },

    async markRoomExpired(roomId) {

      const room = rooms.get(roomId);

      if (!room || room.status !== 'active') return null;

      room.status = 'expired';

      return { id: room.id, status: room.status };

    },

    async markRoomEnded(roomId) {

      const room = rooms.get(roomId);

      if (!room) return null;

      if (room.status === 'active') {

        room.status = 'ended';

      }

      return { id: room.id, status: room.status };

    },

    async updateRoomOwnerId(roomId, ownerId) {

      const room = rooms.get(roomId);

      if (!room) return null;

      room.owner_id = ownerId;

      return { ...room };

    },

    async cancelPendingCoordinatorTransfers(roomId, {

      cancelledAt = new Date(now()).toISOString(),

    } = {}) {

      const cancelled = [];

      for (const transfer of coordinatorTransfers.values()) {

        if (

          transfer.room_id === roomId

          && !transfer.claimed_at

          && !transfer.cancelled_at

        ) {

          transfer.cancelled_at = cancelledAt;

          cancelled.push({ id: transfer.id });

        }

      }

      return cancelled;

    },

    async insertCoordinatorTransfer(row) {

      const id = row.id || cryptoRandomUuid();

      const record = {

        claimed_at: null,

        cancelled_at: null,

        ...row,

        id,

        created_at: row.created_at || new Date(now()).toISOString(),

      };

      if ([...coordinatorTransfers.values()].some(

        (t) => t.claim_token_hash === record.claim_token_hash,

      )) {

        const err = new Error('duplicate claim token hash');

        err.code = '23505';

        throw err;

      }

      const hasOpen = [...coordinatorTransfers.values()].some(

        (t) => t.room_id === record.room_id && !t.claimed_at && !t.cancelled_at,

      );

      if (hasOpen) {

        const err = new Error('duplicate pending transfer');

        err.code = '23505';

        throw err;

      }

      coordinatorTransfers.set(id, record);

      return { ...record };

    },

    async getCoordinatorTransferByClaimHash(claimTokenHash) {

      return [...coordinatorTransfers.values()]

        .find((t) => t.claim_token_hash === claimTokenHash) || null;

    },

    async markCoordinatorTransferClaimed(transferId, {

      claimedAt = new Date(now()).toISOString(),

    } = {}) {

      const transfer = coordinatorTransfers.get(transferId);

      if (!transfer || transfer.claimed_at || transfer.cancelled_at) return null;

      transfer.claimed_at = claimedAt;

      return { ...transfer };

    },

    async revokeInviteById(inviteId, { revokedAt = new Date(now()).toISOString() } = {}) {

      const invite = invites.get(inviteId);

      if (!invite) return null;

      if (!invite.revoked_at) {

        invite.revoked_at = revokedAt;

      }

      return { ...invite };

    },

    async revokeActiveInvitesForRoom(roomId, { revokedAt = new Date(now()).toISOString() } = {}) {

      let count = 0;

      for (const invite of invites.values()) {

        if (invite.room_id === roomId && !invite.revoked_at) {

          invite.revoked_at = revokedAt;

          count += 1;

        }

      }

      return count;

    },

    async getPromptDocument(roomId) {

      return prompts.get(roomId) ? { ...prompts.get(roomId) } : null;

    },

    async ensurePromptDocument(roomId) {

      if (!prompts.has(roomId)) {

        prompts.set(roomId, {

          room_id: roomId,

          latest_snapshot: '',

          revision: 0,

          yjs_state: null,

          updated_by: null,

          updated_at: new Date(now()).toISOString(),

          is_locked: false,

        });

      }

      return { ...prompts.get(roomId) };

    },

    async setPromptLocked(roomId, locked) {

      await this.ensurePromptDocument(roomId);

      const doc = prompts.get(roomId);

      doc.is_locked = Boolean(locked);

      doc.updated_at = new Date(now()).toISOString();

      return { ...doc };

    },

    async updatePromptDraft(roomId, draft, updatedBy, { yjsState } = {}) {

      await this.ensurePromptDocument(roomId);

      const doc = prompts.get(roomId);

      if (doc.is_locked) return null;

      doc.latest_snapshot = draft;

      doc.revision = Number(doc.revision || 0) + 1;

      doc.updated_by = updatedBy || null;

      doc.updated_at = new Date(now()).toISOString();

      if (typeof yjsState === 'string') {

        doc.yjs_state = yjsState;

      }

      return { ...doc };

    },

    async listPromptVersions(roomId) {

      return (versions.get(roomId) || []).map((v) => ({ ...v }));

    },

    async getPromptVersion(roomId, versionNumber) {

      return (versions.get(roomId) || []).find((v) => v.version_number === versionNumber) || null;

    },

    async insertPromptVersion(row) {

      const list = versions.get(row.room_id) || [];

      if (list.some((v) => v.version_number === row.version_number)) {

        const err = new Error('duplicate version');

        err.code = '23505';

        throw err;

      }

      const record = {

        id: cryptoRandomUuid(),

        ...row,

        created_at: row.created_at || new Date(now()).toISOString(),

      };

      list.push(record);

      versions.set(row.room_id, list);

      return { ...record };

    },

    async tryConsumeInvite(inviteId) {

      const invite = invites.get(inviteId);

      if (!invite) return null;

      const room = rooms.get(invite.room_id);

      if (!room || room.status !== 'active') return null;

      if (room.expires_at && Date.parse(room.expires_at) <= now()) {

        if (room.status === 'active') room.status = 'expired';

        return null;

      }

      if (invite.revoked_at) return null;

      if (invite.expires_at && Date.parse(invite.expires_at) <= now()) return null;

      if (invite.max_uses != null && invite.used_count >= invite.max_uses) return null;

      invite.used_count += 1;

      return { ...invite };

    },

    

    async insertParticipantRejoinGrant(row) {

      const id = row.id || cryptoRandomUuid();

      const record = {

        created_at: new Date(now()).toISOString(),

        last_used_at: null,

        revoked_at: null,

        ...row,

        id,

      };

      if ([...rejoinGrants.values()].some((g) => g.token_hash === record.token_hash)) {

        const err = new Error('duplicate rejoin token hash');

        err.code = '23505';

        throw err;

      }

      rejoinGrants.set(id, record);

      return { ...record };

    },



    async getParticipantRejoinGrantByTokenHash(tokenHash) {

      return [...rejoinGrants.values()].find((g) => g.token_hash === tokenHash) || null;

    },



    async touchParticipantRejoinGrant(grantId, {

      participantIdentity,

      lastUsedAt = new Date(now()).toISOString(),

    } = {}) {

      const grant = rejoinGrants.get(grantId);

      if (!grant || grant.revoked_at) return null;

      grant.last_used_at = lastUsedAt;

      if (typeof participantIdentity === 'string' && participantIdentity) {

        grant.participant_identity = participantIdentity;

      }

      return { ...grant };

    },



    async revokeParticipantRejoinGrantByParticipantIdentity(roomId, participantIdentity, {

      revokedAt = new Date(now()).toISOString(),

    } = {}) {

      let count = 0;

      for (const grant of rejoinGrants.values()) {

        if (

          grant.room_id === roomId

          && grant.participant_identity === participantIdentity

          && !grant.revoked_at

        ) {

          grant.revoked_at = revokedAt;

          count += 1;

        }

      }

      return count;

    },



    async revokeParticipantRejoinGrantsForRoom(roomId, {

      revokedAt = new Date(now()).toISOString(),

    } = {}) {

      let count = 0;

      for (const grant of rejoinGrants.values()) {

        if (grant.room_id === roomId && !grant.revoked_at) {

          grant.revoked_at = revokedAt;

          count += 1;

        }

      }

      return count;

    },



    async deleteParticipantRejoinGrant(grantId) {

      rejoinGrants.delete(grantId);

    },

async deleteRoomCascade(roomId) {

      rooms.delete(roomId);

      prompts.delete(roomId);

      versions.delete(roomId);

      for (const [id, invite] of invites) {

        if (invite.room_id === roomId) invites.delete(id);

      }

      

      for (const [id, grant] of rejoinGrants) {

        if (grant.room_id === roomId) rejoinGrants.delete(id);

      }

for (const [id, transfer] of coordinatorTransfers) {

        if (transfer.room_id === roomId) coordinatorTransfers.delete(id);

      }

      for (let i = audits.length - 1; i >= 0; i -= 1) {

        if (audits[i].room_id === roomId) audits.splice(i, 1);

      }

    },

  };

}



function cryptoRandomUuid() {

  return globalThis.crypto.randomUUID();

}

