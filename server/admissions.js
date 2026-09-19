import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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