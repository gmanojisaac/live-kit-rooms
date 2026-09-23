/**
 * Prompt workspace service (Phase 4).
 * Live collaborative state is Yjs over LiveKit Data Channels.
 * Supabase holds durable snapshots + immutable named versions.
 * PUT is snapshot persistence only — not a concurrent-edit path.
 */

import { assertServerOnly } from '../security/server-only.js';
import { createRoomRepository } from '../rooms/repository.js';
import { ROOM_STATUS } from '../rooms/policy.js';
import { resolveRoomStatus } from '../rooms/status.js';
import { ensureRoomNotStaleActive } from '../rooms/owner-auth.js';
import { AUDIT_EVENT } from '../rooms/audit.js';
import { MAX_PROMPT_LENGTH, defaultVersionName } from './constants.js';

export { MAX_PROMPT_LENGTH };

export class PromptError extends Error {
  constructor(message, { httpStatus = 400, code = 'BAD_REQUEST' } = {}) {
    super(message);
    this.name = 'PromptError';
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

function toPublicPrompt(doc, versions, roomStatus) {
  const locked = Boolean(doc?.is_locked)
    || roomStatus === ROOM_STATUS.ENDED
    || roomStatus === ROOM_STATUS.EXPIRED;
  return {
    draft: doc?.latest_snapshot ?? '',
    /** @deprecated use draft — kept for older clients */
    content: doc?.latest_snapshot ?? '',
    revision: Number(doc?.revision || 0),
    yjsState: doc?.yjs_state || null,
    updatedAt: doc?.updated_at || null,
    updatedBy: doc?.updated_by || null,
    locked,
    isLocked: Boolean(doc?.is_locked),
    roomStatus,
    readOnly: locked,
    versions: (versions || []).map((v) => ({
      id: v.id,
      version: v.version_number,
      name: v.name || null,
      prompt: v.content,
      createdAt: v.created_at,
      finalizedBy: v.created_by || null,
    })),
  };
}

async function loadRoomContext(slug, repository, now) {
  const room = await repository.getRoomBySlug(slug);
  if (!room) {
    throw new PromptError('Room not found.', {
      httpStatus: 404,
      code: 'ROOM_NOT_FOUND',
    });
  }
  const status = await ensureRoomNotStaleActive(room, repository, { now });
  return { room, status };
}

function assertWritable(status, doc) {
  if (status === ROOM_STATUS.ENDED) {
    throw new PromptError('This room has ended. Prompt is read-only.', {
      httpStatus: 410,
      code: 'ROOM_ENDED',
    });
  }
  if (status === ROOM_STATUS.EXPIRED) {
    throw new PromptError('This room has expired. Prompt is read-only.', {
      httpStatus: 410,
      code: 'ROOM_EXPIRED',
    });
  }
  if (doc?.is_locked) {
    throw new PromptError('Prompt editing is locked by the room owner.', {
      httpStatus: 409,
      code: 'PROMPT_LOCKED',
    });
  }
}

async function writeAudit(repository, row) {
  try {
    return await repository.insertAuditEvent(row);
  } catch {
    return null;
  }
}

/**
 * GET prompt workspace state (snapshot + versions). Always readable when room exists.
 * Live editors must not treat `draft` as authoritative while Yjs is connected.
 */
export async function getPromptWorkspace({
  slug,
  repository,
  now = Date.now,
}) {
  assertServerOnly();
  const repo = repository || createRoomRepository();
  const { room, status } = await loadRoomContext(slug, repo, now);
  const doc = await repo.ensurePromptDocument(room.id);
  const versions = await repo.listPromptVersions(room.id);
  return toPublicPrompt(doc, versions, status);
}

/**
 * Persist a debounced snapshot of the current collaborative document.
 * Not a last-write-wins collaboration channel — Yjs is authoritative while live.
 */
export async function persistPromptSnapshot({
  slug,
  content,
  yjsState = null,
  updatedBy,
  repository,
  now = Date.now,
}) {
  assertServerOnly();

  const draft = typeof content === 'string' ? content : null;
  if (draft === null) {
    throw new PromptError('Snapshot content must be a string.', {
      httpStatus: 422,
      code: 'INVALID_DRAFT',
    });
  }
  if (draft.length > MAX_PROMPT_LENGTH) {
    throw new PromptError(`Draft must be at most ${MAX_PROMPT_LENGTH} characters.`, {
      httpStatus: 422,
      code: 'DRAFT_TOO_LONG',
    });
  }
  if (yjsState != null && typeof yjsState !== 'string') {
    throw new PromptError('yjsState must be a base64 string when provided.', {
      httpStatus: 422,
      code: 'INVALID_YJS_STATE',
    });
  }
  if (typeof yjsState === 'string' && yjsState.length > 2_000_000) {
    throw new PromptError('yjsState is too large.', {
      httpStatus: 422,
      code: 'YJS_STATE_TOO_LARGE',
    });
  }

  const repo = repository || createRoomRepository();
  const { room, status } = await loadRoomContext(slug, repo, now);
  const doc = await repo.ensurePromptDocument(room.id);
  assertWritable(status, doc);

  const updated = await repo.updatePromptDraft(room.id, draft, updatedBy, { yjsState });
  if (!updated) {
    throw new PromptError('Prompt editing is locked by the room owner.', {
      httpStatus: 409,
      code: 'PROMPT_LOCKED',
    });
  }

  const versions = await repo.listPromptVersions(room.id);
  return toPublicPrompt(updated, versions, status);
}

/**
 * @deprecated Alias for persistPromptSnapshot — kept for older test call sites.
 * Must not be used as a concurrent collaboration path.
 */
export async function putPromptDraft(args) {
  const content = args.draft !== undefined ? args.draft : args.content;
  return persistPromptSnapshot({ ...args, content });
}

/**
 * Finalize current shared prompt text into an immutable named version.
 * `content` must be the authoritative Yjs document text at finalize time.
 */
export async function finalizePrompt({
  slug,
  content,
  name,
  finalizedBy,
  repository,
  now = Date.now,
}) {
  assertServerOnly();
  const repo = repository || createRoomRepository();
  const { room, status } = await loadRoomContext(slug, repo, now);
  const doc = await repo.ensurePromptDocument(room.id);
  assertWritable(status, doc);

  const text = typeof content === 'string'
    ? content
    : (doc.latest_snapshot ?? '');

  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new PromptError('Prompt draft is empty.', {
      httpStatus: 400,
      code: 'EMPTY_DRAFT',
    });
  }
  if (text.length > MAX_PROMPT_LENGTH) {
    throw new PromptError(`Draft must be at most ${MAX_PROMPT_LENGTH} characters.`, {
      httpStatus: 422,
      code: 'DRAFT_TOO_LONG',
    });
  }

  const fresh = await repo.getPromptDocument(room.id);
  assertWritable(status, fresh);

  const versionName = typeof name === 'string' && name.trim()
    ? name.trim().slice(0, 120)
    : null;

  let entry = null;
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const existing = await repo.listPromptVersions(room.id);
    const versionNumber = existing.length + 1;
    const resolvedName = versionName || defaultVersionName(versionNumber);
    try {
      entry = await repo.insertPromptVersion({
        room_id: room.id,
        version_number: versionNumber,
        name: resolvedName,
        content: text,
        created_by: finalizedBy || null,
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (error?.code === '23505') {
        continue;
      }
      throw error;
    }
  }

  if (!entry) {
    throw new PromptError(
      lastError?.message || 'Could not allocate a unique version number.',
      { httpStatus: 409, code: 'VERSION_CONFLICT' },
    );
  }

  // Keep durable draft aligned with finalized content; draft remains editable after.
  await repo.updatePromptDraft(room.id, text, finalizedBy || null).catch(() => null);

  await writeAudit(repo, {
    room_id: room.id,
    event_type: AUDIT_EVENT.PROMPT_VERSION_CREATED,
    actor_id: finalizedBy || null,
    metadata_minimal: {
      slug: room.slug,
      version: entry.version_number,
      name: entry.name,
      contentLength: text.length,
    },
  });

  return {
    version: entry.version_number,
    name: entry.name,
    prompt: entry.content,
    status: 'finalized',
    createdAt: entry.created_at,
    finalizedBy: entry.created_by,
    roomStatus: status,
    locked: Boolean(fresh?.is_locked),
  };
}

export async function getPromptVersion({
  slug,
  version,
  repository,
  now = Date.now,
}) {
  assertServerOnly();
  const repo = repository || createRoomRepository();
  const { room, status } = await loadRoomContext(slug, repo, now);
  const versionNumber = Number(version);
  if (!Number.isInteger(versionNumber) || versionNumber < 1) {
    throw new PromptError('Invalid version number.', {
      httpStatus: 422,
      code: 'INVALID_VERSION',
    });
  }
  const entry = await repo.getPromptVersion(room.id, versionNumber);
  if (!entry) {
    throw new PromptError('Version not found.', {
      httpStatus: 404,
      code: 'VERSION_NOT_FOUND',
    });
  }
  return {
    version: entry.version_number,
    name: entry.name,
    prompt: entry.content,
    createdAt: entry.created_at,
    finalizedBy: entry.created_by,
    roomStatus: status,
  };
}

export function isPromptReadOnly(room, doc, { now = Date.now } = {}) {
  const status = resolveRoomStatus(room, { now });
  if (status === ROOM_STATUS.ENDED || status === ROOM_STATUS.EXPIRED) return true;
  return Boolean(doc?.is_locked);
}
