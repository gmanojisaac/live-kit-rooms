import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Single source of truth for pending-seat hold and LiveKit join-token lifetime.
export const RESERVATION_TTL_MS = 2 * 60 * 1000;

export function createReservation(leaveKey, now = Date.now) {
  return { leaveKey, pendingUntil: now() + RESERVATION_TTL_MS };
}

// One application server owns this store. Persist reservations before returning tokens,
// so restarting that server cannot forget outstanding admissions.
export function createAdmissionStore(file) {
  const entries = new Map(file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []);
  let queue = Promise.resolve();
  return {
    entries,
    save() {
      if (!file) return;
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file + '.tmp', JSON.stringify([...entries]), { mode: 0o600 });
      renameSync(file + '.tmp', file);
    },
    exclusive(task) {
      const result = queue.then(task);
      queue = result.catch(() => {});
      return result;
    },
  };
}
