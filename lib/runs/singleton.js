/**
 * Process-wide manual-run store for Next.js (dev / single-instance).
 * Mirrors the Express prototype: JPEG results stay in memory for the room session.
 */
import { createRunStore } from '../runs-store.js';

const globalKey = '__lkr_manual_run_store__';

export function getRunStore() {
  if (!globalThis[globalKey]) {
    globalThis[globalKey] = createRunStore();
  }
  return globalThis[globalKey];
}
