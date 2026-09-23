/**
 * Six-user concurrent CRDT harness (AT-07 preparation).
 * Pure Yjs — no LiveKit required. Physical six-browser acceptance is separate.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPromptDoc,
  applyLocalTextDiff,
  getPromptText,
  mergeDocs,
} from '../../lib/prompts/yjs-doc.js';

test('AT-07 harness: six simultaneous editors retain all committed markers', () => {
  const peers = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1,
    ...createPromptDoc(),
  }));

  applyLocalTextDiff(peers[0].ytext, 'START<<SECTION>>END');
  for (let i = 1; i < 6; i += 1) mergeDocs(peers[0].doc, peers[i].doc);

  const edits = [
    (t) => t.replace('START', 'START{P1}'),
    (t) => t.replace('<<', '{P2}<<'),
    (t) => t.replace('SECTION', 'SEC{P3}TION'),
    (t) => t.replace('>>', '>>{P4}'),
    (t) => t.replace('END', '{P5}END'),
    (t) => `${t}{P6}`,
  ];

  peers.forEach((peer, index) => {
    const next = edits[index](getPromptText(peer.doc));
    applyLocalTextDiff(peer.ytext, next);
  });

  for (let round = 0; round < 4; round += 1) {
    for (let i = 0; i < peers.length; i += 1) {
      for (let j = 0; j < peers.length; j += 1) {
        if (i !== j) mergeDocs(peers[i].doc, peers[j].doc);
      }
    }
  }

  const converged = peers.map((p) => getPromptText(p.doc));
  assert.ok(
    converged.every((t) => t === converged[0]),
    `peers diverged: ${JSON.stringify(converged)}`,
  );
  for (const marker of ['{P1}', '{P2}', '{P3}', '{P4}', '{P5}', '{P6}']) {
    assert.match(converged[0], new RegExp(marker.replace(/[{}]/g, '\\$&')));
  }
});
