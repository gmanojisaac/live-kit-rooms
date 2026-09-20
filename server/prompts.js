// In-memory prompt state for the single application server.
// Finalized versions are immutable snapshots; only the draft mutates between finalizations.

export const MAX_PROMPT_LENGTH = 50_000;

function emptyState() {
  return { draft: '', versions: [] };
}

function publicState(state) {
  return {
    draft: state.draft,
    version: state.versions.length,
    status: 'draft',
    versions: state.versions.map(entry => ({ ...entry })),
  };
}

export function createPromptStore({ now = Date.now } = {}) {
  const rooms = new Map();
  let queue = Promise.resolve();

  function stateFor(roomName) {
    let state = rooms.get(roomName);
    if (!state) {
      state = emptyState();
      rooms.set(roomName, state);
    }
    return state;
  }

  return {
    exclusive(task) {
      const result = queue.then(task);
      queue = result.catch(() => {});
      return result;
    },
    get(roomName) {
      return publicState(stateFor(roomName));
    },
    getVersion(roomName, version) {
      const state = stateFor(roomName);
      return state.versions.find(entry => entry.version === version) || null;
    },
    putDraft(roomName, draft) {
      const state = stateFor(roomName);
      state.draft = draft;
      return publicState(state);
    },
    finalize(roomName, finalizedBy) {
      const state = stateFor(roomName);
      if (typeof state.draft !== 'string' || state.draft.trim().length === 0) {
        const error = new Error('Prompt draft is empty.');
        error.code = 'EMPTY_DRAFT';
        throw error;
      }
      const entry = {
        version: state.versions.length + 1,
        prompt: state.draft,
        createdAt: new Date(now()).toISOString(),
        finalizedBy,
      };
      // Never mutate prior entries; only append.
      state.versions = [...state.versions, entry];
      return {
        version: entry.version,
        prompt: entry.prompt,
        status: 'finalized',
        createdAt: entry.createdAt,
        finalizedBy: entry.finalizedBy,
      };
    },
  };
}
