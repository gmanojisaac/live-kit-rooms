/**
 * Room-scoped Yjs document helpers.
 * One Y.Doc per room; shared text lives at Y.Text('prompt').
 * No secrets belong in the document.
 */

import * as Y from 'yjs';
import { YJS_PROMPT_KEY, MAX_PROMPT_LENGTH } from './constants.js';

/**
 * Create an empty collaborative prompt document.
 * @returns {{ doc: Y.Doc, ytext: Y.Text }}
 */
export function createPromptDoc() {
  const doc = new Y.Doc();
  const ytext = doc.getText(YJS_PROMPT_KEY);
  return { doc, ytext };
}

export function getPromptText(doc) {
  return doc.getText(YJS_PROMPT_KEY).toString();
}

/**
 * Apply a UTF-16-aware prefix/suffix diff into Y.Text (incremental, not full replace).
 * Concurrent non-overlapping edits merge via Yjs; do not use last-write-wins string PUT.
 */
export function applyLocalTextDiff(ytext, next, origin = 'local') {
  const prev = ytext.toString();
  if (prev === next) return;
  if (typeof next !== 'string') {
    throw new TypeError('Prompt text must be a string.');
  }
  if (next.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Prompt must be at most ${MAX_PROMPT_LENGTH} characters.`);
  }

  let start = 0;
  const minLen = Math.min(prev.length, next.length);
  while (start < minLen && prev[start] === next[start]) start += 1;

  let endPrev = prev.length;
  let endNext = next.length;
  while (
    endPrev > start
    && endNext > start
    && prev[endPrev - 1] === next[endNext - 1]
  ) {
    endPrev -= 1;
    endNext -= 1;
  }

  ytext.doc.transact(() => {
    if (endPrev > start) {
      ytext.delete(start, endPrev - start);
    }
    if (endNext > start) {
      ytext.insert(start, next.slice(start, endNext));
    }
  }, origin);
}

/**
 * Seed an empty doc from a durable text snapshot (alone / cold start only).
 * Callers must not seed after peer sync has already populated the doc.
 */
export function seedFromSnapshot(doc, snapshot, origin = 'server-snapshot') {
  const text = typeof snapshot === 'string' ? snapshot : '';
  const ytext = doc.getText(YJS_PROMPT_KEY);
  if (ytext.length > 0) return false;
  if (!text) return false;
  ytext.doc.transact(() => {
    ytext.insert(0, text.slice(0, MAX_PROMPT_LENGTH));
  }, origin);
  return true;
}

function decodeBase64ToUint8(b64) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function encodeUint8ToBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/**
 * Restore CRDT state from a base64-encoded Yjs update (preferred over text seed).
 */
export function applyYjsStateBase64(doc, yjsStateBase64) {
  if (!yjsStateBase64 || typeof yjsStateBase64 !== 'string') return false;
  try {
    const bytes = decodeBase64ToUint8(yjsStateBase64);
    if (!bytes.length) return false;
    Y.applyUpdate(doc, bytes, 'server-yjs-state');
    return true;
  } catch {
    return false;
  }
}

export function encodeYjsStateBase64(doc) {
  return encodeUint8ToBase64(Y.encodeStateAsUpdate(doc));
}

/**
 * Merge two independent docs (unit-test helper for CRDT correctness).
 */
export function mergeDocs(docA, docB) {
  const updateA = Y.encodeStateAsUpdate(docA);
  const updateB = Y.encodeStateAsUpdate(docB);
  Y.applyUpdate(docA, updateB);
  Y.applyUpdate(docB, updateA);
}

export function applyUpdateBytes(doc, update, origin = 'remote') {
  if (!update || !(update instanceof Uint8Array) || update.length === 0) return;
  Y.applyUpdate(doc, update, origin);
}

export { Y };
