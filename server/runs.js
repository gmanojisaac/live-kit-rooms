import { randomUUID } from 'node:crypto';

export const RUN_STATUSES = Object.freeze(['success', 'failure']);
export const MAX_RUN_NOTES_LENGTH = 2_000;

function publicRun(run, roomName) {
  return {
    id: run.id,
    roomName,
    promptVersion: run.promptVersion,
    promptSnapshot: run.promptSnapshot,
    executedBy: run.executedBy,
    executedAt: run.executedAt,
    status: run.status,
    notes: run.notes,
    imageUrl: `/api/rooms/${encodeURIComponent(roomName)}/runs/${encodeURIComponent(run.id)}/image`,
  };
}

export function createRunStore({ now = Date.now, createId = () => 'run_' + randomUUID() } = {}) {
  // roomName -> Map(runId -> { metadata..., jpeg: Buffer })
  const rooms = new Map();
  let queue = Promise.resolve();

  function roomMap(roomName) {
    let map = rooms.get(roomName);
    if (!map) {
      map = new Map();
      rooms.set(roomName, map);
    }
    return map;
  }

  return {
    exclusive(task) {
      const result = queue.then(task);
      queue = result.catch(() => {});
      return result;
    },
    create(roomName, {
      promptVersion, promptSnapshot, executedBy, status, notes = '', jpeg,
    }) {
      if (!RUN_STATUSES.includes(status)) {
        const error = new Error('Status must be success or failure.');
        error.code = 'INVALID_STATUS';
        throw error;
      }
      if (typeof notes !== 'string') {
        const error = new Error('Notes must be a string.');
        error.code = 'INVALID_NOTES';
        throw error;
      }
      if (notes.length > MAX_RUN_NOTES_LENGTH) {
        const error = new Error(`Notes exceed the maximum length of ${MAX_RUN_NOTES_LENGTH} characters.`);
        error.code = 'NOTES_TOO_LONG';
        throw error;
      }
      if (!Buffer.isBuffer(jpeg) || jpeg.length === 0) {
        const error = new Error('A JPEG result image is required.');
        error.code = 'MISSING_JPEG';
        throw error;
      }

      const id = createId();
      const run = {
        id,
        promptVersion,
        promptSnapshot,
        executedBy,
        executedAt: new Date(now()).toISOString(),
        status,
        notes,
        jpeg,
      };
      // Store metadata and JPEG together so creation is atomic in-memory.
      roomMap(roomName).set(id, run);
      return publicRun(run, roomName);
    },
    list(roomName) {
      const map = rooms.get(roomName);
      if (!map) return [];
      return [...map.values()]
        .sort((left, right) => {
          if (left.executedAt === right.executedAt) return right.id.localeCompare(left.id);
          return right.executedAt.localeCompare(left.executedAt);
        })
        .map(run => publicRun(run, roomName));
    },
    get(roomName, runId) {
      const run = rooms.get(roomName)?.get(runId);
      return run ? publicRun(run, roomName) : null;
    },
    getJpeg(roomName, runId) {
      const run = rooms.get(roomName)?.get(runId);
      return run ? run.jpeg : null;
    },
  };
}
