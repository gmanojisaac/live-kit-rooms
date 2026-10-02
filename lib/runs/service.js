/**
 * Work-log service: manual prompt runs and work-progress uploads.
 * Metadata is stored in Supabase (prompt_runs); JPEG bytes in the private
 * live-kit storage bucket. Execution stays manual — this app never runs prompts.
 */

import { randomUUID } from 'node:crypto';
import { assertServerOnly } from '../security/server-only.js';
import { createRoomRepository } from '../rooms/repository.js';
import { isValidRoomSlug } from '../rooms/slug.js';
import { normalizeDisplayName } from '../rooms/display-name.js';
import { matchTeamMember } from '../rooms/team.js';

export const RUN_KINDS = Object.freeze(['run', 'progress']);
export const RUN_STATUSES = Object.freeze(['success', 'failure']);
export const MAX_RUN_NOTES_LENGTH = 2_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class RunError extends Error {
  constructor(message, { httpStatus = 400, code = 'BAD_REQUEST' } = {}) {
    super(message);
    this.name = 'RunError';
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

function toPublicRun(run, slug) {
  return {
    id: run.id,
    roomName: slug,
    kind: run.kind,
    promptVersion: run.prompt_version ?? null,
    promptSnapshot: run.prompt_snapshot ?? null,
    executedBy: run.executed_by,
    executedAt: run.created_at,
    status: run.status ?? null,
    notes: run.notes || '',
    imageUrl: `/api/rooms/${encodeURIComponent(slug)}/runs/${encodeURIComponent(run.id)}/image`,
  };
}

async function loadRoom(slug, repository) {
  const room = isValidRoomSlug(slug) ? await repository.getRoomBySlug(slug) : null;
  if (!room) {
    throw new RunError('Room not found.', { httpStatus: 404, code: 'ROOM_NOT_FOUND' });
  }
  return room;
}

function resolveExecutedBy(executedBy, teamMembers) {
  if (Array.isArray(teamMembers) && teamMembers.length > 0) {
    const member = matchTeamMember(executedBy, teamMembers);
    if (!member) {
      throw new RunError('Saved-by name must be a team member.', {
        httpStatus: 422,
        code: 'NOT_A_TEAM_MEMBER',
      });
    }
    return member;
  }
  const check = normalizeDisplayName(executedBy);
  return check.ok ? check.displayName : 'Participant';
}

/**
 * Save a work-log entry with its JPEG.
 * kind 'run' = result of a finalized prompt version; 'progress' = standalone work upload.
 */
export async function createRun({
  slug,
  kind = 'run',
  promptVersion,
  status,
  notes = '',
  executedBy,
  jpeg,
  teamMembers = [],
  repository,
}) {
  assertServerOnly();

  if (!RUN_KINDS.includes(kind)) {
    throw new RunError('Kind must be run or progress.', { httpStatus: 422, code: 'INVALID_KIND' });
  }
  if (typeof notes !== 'string') {
    throw new RunError('Notes must be a string.', { httpStatus: 422, code: 'INVALID_NOTES' });
  }
  if (notes.length > MAX_RUN_NOTES_LENGTH) {
    throw new RunError(`Notes exceed the maximum length of ${MAX_RUN_NOTES_LENGTH} characters.`, {
      httpStatus: 422,
      code: 'NOTES_TOO_LONG',
    });
  }
  if (!Buffer.isBuffer(jpeg) || jpeg.length === 0) {
    throw new RunError('A JPEG image is required.', { httpStatus: 422, code: 'MISSING_JPEG' });
  }

  const isRun = kind === 'run';
  if (isRun && !RUN_STATUSES.includes(status)) {
    throw new RunError('Status must be success or failure.', {
      httpStatus: 422,
      code: 'INVALID_STATUS',
    });
  }
  const versionNumber = Number(promptVersion);
  if (isRun && (!Number.isInteger(versionNumber) || versionNumber < 1)) {
    throw new RunError('Select a finalized prompt version.', {
      httpStatus: 422,
      code: 'INVALID_VERSION',
    });
  }

  const savedBy = resolveExecutedBy(executedBy, teamMembers);
  const repo = repository || createRoomRepository();
  const room = await loadRoom(slug, repo);

  let promptSnapshot = null;
  if (isRun) {
    const version = await repo.getPromptVersion(room.id, versionNumber);
    if (!version) {
      throw new RunError('Version not found.', { httpStatus: 404, code: 'VERSION_NOT_FOUND' });
    }
    promptSnapshot = version.content || '';
  }

  const id = randomUUID();
  const imagePath = `${room.id}/${id}.jpg`;
  await repo.uploadRunImage(imagePath, jpeg);

  let run;
  try {
    run = await repo.insertRun({
      id,
      room_id: room.id,
      kind,
      prompt_version: isRun ? versionNumber : null,
      prompt_snapshot: promptSnapshot,
      executed_by: savedBy,
      status: isRun ? status : null,
      notes,
      image_path: imagePath,
    });
  } catch (error) {
    // Do not leave an orphaned JPEG when the metadata row fails.
    await repo.removeRunImage(imagePath).catch(() => {});
    throw error;
  }

  return toPublicRun(run, room.slug);
}

/** List work-log entries, newest first. Optionally filter by who saved them. */
export async function listRuns({ slug, executedBy = null, repository }) {
  assertServerOnly();
  const repo = repository || createRoomRepository();
  const room = await loadRoom(slug, repo);
  const filter = typeof executedBy === 'string' && executedBy.trim() ? executedBy.trim() : null;
  const runs = await repo.listRuns(room.id, { executedBy: filter });
  return runs.map((run) => toPublicRun(run, room.slug));
}

async function loadRun(slug, runId, repo) {
  const room = await loadRoom(slug, repo);
  const run = typeof runId === 'string' && UUID_PATTERN.test(runId)
    ? await repo.getRun(room.id, runId)
    : null;
  if (!run) {
    throw new RunError('Run not found.', { httpStatus: 404, code: 'RUN_NOT_FOUND' });
  }
  return { room, run };
}

export async function getRun({ slug, runId, repository }) {
  assertServerOnly();
  const repo = repository || createRoomRepository();
  const { room, run } = await loadRun(slug, runId, repo);
  return toPublicRun(run, room.slug);
}

/** @returns {Promise<Buffer>} JPEG bytes for a work-log entry. */
export async function getRunImage({ slug, runId, repository }) {
  assertServerOnly();
  const repo = repository || createRoomRepository();
  const { run } = await loadRun(slug, runId, repo);
  return repo.downloadRunImage(run.image_path);
}
