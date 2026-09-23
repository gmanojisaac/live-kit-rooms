/**
 * Phase 4 Yjs CRDT unit tests (no browser / LiveKit required).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPromptDoc,
  applyLocalTextDiff,
  getPromptText,
  mergeDocs,
  seedFromSnapshot,
  applyYjsStateBase64,
  encodeYjsStateBase64,
  applyUpdateBytes,
  Y,
} from '../../lib/prompts/yjs-doc.js';
import { defaultVersionName, MAX_PROMPT_LENGTH } from '../../lib/prompts/constants.js';

test('one editor updates shared text', () => {
  const { doc, ytext } = createPromptDoc();
  applyLocalTextDiff(ytext, 'Review the project');
  assert.equal(getPromptText(doc), 'Review the project');
});

test('two concurrent edits both survive merge', () => {
  const a = createPromptDoc();
  const b = createPromptDoc();
  applyLocalTextDiff(a.ytext, 'Review the project');
  mergeDocs(a.doc, b.doc);

  applyLocalTextDiff(a.ytext, 'Review carefully the project');
  applyLocalTextDiff(b.ytext, 'Review the project for security');
  mergeDocs(a.doc, b.doc);

  const textA = getPromptText(a.doc);
  const textB = getPromptText(b.doc);
  assert.equal(textA, textB);
  assert.match(textA, /carefully/);
  assert.match(textA, /for security/);
  assert.match(textA, /Review/);
  assert.match(textA, /project/);
});

test('six concurrent non-identical edits all survive', () => {
  const docs = Array.from({ length: 6 }, () => createPromptDoc());
  applyLocalTextDiff(docs[0].ytext, 'BASETEXT');
  for (let i = 1; i < 6; i += 1) mergeDocs(docs[0].doc, docs[i].doc);

  applyLocalTextDiff(docs[0].ytext, '[1]BASETEXT');
  applyLocalTextDiff(docs[1].ytext, 'BA[2]SETEXT');
  applyLocalTextDiff(docs[2].ytext, 'BASE[3]TEXT');
  applyLocalTextDiff(docs[3].ytext, 'BASETEXT[4]');
  applyLocalTextDiff(docs[4].ytext, 'B[5]ASETEXT');
  applyLocalTextDiff(docs[5].ytext, 'BASETE[6]XT');

  for (let round = 0; round < 3; round += 1) {
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 6; j += 1) {
        if (i !== j) mergeDocs(docs[i].doc, docs[j].doc);
      }
    }
  }

  const texts = docs.map((d) => getPromptText(d.doc));
  assert.ok(texts.every((t) => t === texts[0]), `diverged: ${JSON.stringify(texts)}`);
  for (const marker of ['[1]', '[2]', '[3]', '[4]', '[5]', '[6]']) {
    assert.match(texts[0], new RegExp(marker.replace(/[[\]]/g, '\\$&')));
  }
});

test('late join receives current document via update exchange', () => {
  const early = createPromptDoc();
  applyLocalTextDiff(early.ytext, 'Already edited prompt');

  const late = createPromptDoc();
  const update = Y.encodeStateAsUpdate(early.doc);
  applyUpdateBytes(late.doc, update, 'remote');
  assert.equal(getPromptText(late.doc), 'Already edited prompt');
});

test('reconnect applies missing updates without dropping local work', () => {
  const local = createPromptDoc();
  const remote = createPromptDoc();
  applyLocalTextDiff(local.ytext, 'base');
  mergeDocs(local.doc, remote.doc);

  applyLocalTextDiff(local.ytext, 'base local');
  applyLocalTextDiff(remote.ytext, 'base remote');

  // Simulate disconnect: only remote continues, then reconnect merge
  applyLocalTextDiff(remote.ytext, 'base remote more');
  mergeDocs(local.doc, remote.doc);

  const text = getPromptText(local.doc);
  assert.match(text, /local/);
  assert.match(text, /remote/);
  assert.match(text, /more/);
});

test('duplicate and out-of-order updates are idempotent', () => {
  const a = createPromptDoc();
  const b = createPromptDoc();
  applyLocalTextDiff(a.ytext, 'hello');
  const update = Y.encodeStateAsUpdate(a.doc);
  applyUpdateBytes(b.doc, update, 'remote');
  applyUpdateBytes(b.doc, update, 'remote'); // duplicate
  applyUpdateBytes(b.doc, update, 'remote');
  assert.equal(getPromptText(b.doc), 'hello');

  // Out-of-order: apply a newer update then an older encoded state still converges
  applyLocalTextDiff(a.ytext, 'hello world');
  const newer = Y.encodeStateAsUpdate(a.doc);
  const older = update;
  applyUpdateBytes(b.doc, newer, 'remote');
  applyUpdateBytes(b.doc, older, 'remote');
  assert.equal(getPromptText(b.doc), 'hello world');
});

test('seed from snapshot only fills empty docs', () => {
  const { doc, ytext } = createPromptDoc();
  assert.equal(seedFromSnapshot(doc, 'snap'), true);
  assert.equal(getPromptText(doc), 'snap');
  assert.equal(seedFromSnapshot(doc, 'other'), false);
  assert.equal(getPromptText(doc), 'snap');
  applyLocalTextDiff(ytext, 'snap!');
  assert.equal(getPromptText(doc), 'snap!');
});

test('yjs state base64 round-trip restores document', () => {
  const a = createPromptDoc();
  applyLocalTextDiff(a.ytext, 'persisted crdt');
  const encoded = encodeYjsStateBase64(a.doc);
  const b = createPromptDoc();
  assert.equal(applyYjsStateBase64(b.doc, encoded), true);
  assert.equal(getPromptText(b.doc), 'persisted crdt');
});

test('character count matches current text and respects max length helper', () => {
  const { doc, ytext } = createPromptDoc();
  applyLocalTextDiff(ytext, 'abcd');
  assert.equal(getPromptText(doc).length, 4);
  assert.equal(MAX_PROMPT_LENGTH, 50_000);
  assert.equal(defaultVersionName(3), 'Version 3');
});

test('room isolation: separate docs do not share state', () => {
  const roomA = createPromptDoc();
  const roomB = createPromptDoc();
  applyLocalTextDiff(roomA.ytext, 'Room A secret');
  assert.equal(getPromptText(roomB.doc), '');
  assert.equal(getPromptText(roomA.doc), 'Room A secret');
});
