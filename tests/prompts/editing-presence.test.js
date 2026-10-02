import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  createLiveKitYjsProvider,
  getEditingPresence,
  awarenessProtocol,
  Y,
} from '../../lib/prompts/livekit-provider.js';
import { createPromptDoc } from '../../lib/prompts/yjs-doc.js';
import {
  encodeCoordinatorRolePayload,
  parseCoordinatorRolePayload,
} from '../../lib/rooms/coordinator-role-client.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function createMockRoom() {
  const emitter = new EventEmitter();
  return {
    state: 'connected',
    localParticipant: {
      identity: 'local-id',
      publishData: async () => {},
    },
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    emit: emitter.emit.bind(emitter),
  };
}

test('connected participants default to no active editor', () => {
  const { doc } = createPromptDoc();
  const room = createMockRoom();
  const provider = createLiveKitYjsProvider({
    room,
    doc,
    displayName: 'Ada',
    participantIdentity: 'id-ada',
  });

  assert.deepEqual(provider.getEditingPresence(), []);
  provider.setEditing(true);
  assert.deepEqual(provider.getEditingPresence(), ['Ada']);
  provider.setEditing(false);
  assert.deepEqual(provider.getEditingPresence(), []);
  provider.destroy();
});

test('active editor list is awareness-driven and shared across docs', () => {
  const a = createPromptDoc();
  const b = createPromptDoc();
  const awarenessA = new awarenessProtocol.Awareness(a.doc);
  const awarenessB = new awarenessProtocol.Awareness(b.doc);

  awarenessA.setLocalStateField('user', { name: 'A', identity: 'a', editing: false });
  awarenessB.setLocalStateField('user', { name: 'B', identity: 'b', editing: false });
  assert.deepEqual(getEditingPresence(awarenessA), []);
  assert.deepEqual(getEditingPresence(awarenessB), []);

  awarenessA.setLocalStateField('user', { name: 'A', identity: 'a', editing: true });
  const update = awarenessProtocol.encodeAwarenessUpdate(awarenessA, [a.doc.clientID]);
  awarenessProtocol.applyAwarenessUpdate(awarenessB, update, 'remote');

  assert.deepEqual(getEditingPresence(awarenessA), ['A']);
  assert.deepEqual(getEditingPresence(awarenessB), ['A']);

  awarenessB.setLocalStateField('user', { name: 'B', identity: 'b', editing: true });
  const updateB = awarenessProtocol.encodeAwarenessUpdate(awarenessB, [b.doc.clientID]);
  awarenessProtocol.applyAwarenessUpdate(awarenessA, updateB, 'remote');

  assert.deepEqual(getEditingPresence(awarenessA).sort(), ['A', 'B']);
  assert.deepEqual(getEditingPresence(awarenessB).sort(), ['A', 'B']);

  awarenessA.setLocalStateField('user', { name: 'A', identity: 'a', editing: false });
  const clearA = awarenessProtocol.encodeAwarenessUpdate(awarenessA, [a.doc.clientID]);
  awarenessProtocol.applyAwarenessUpdate(awarenessB, clearA, 'remote');
  assert.deepEqual(getEditingPresence(awarenessB), ['B']);

  awarenessA.destroy();
  awarenessB.destroy();
});

test('coordinator role payload is informational and parseable', () => {
  const bytes = encodeCoordinatorRolePayload({ coordinatorIdentity: 'coord-1' });
  const parsed = parseCoordinatorRolePayload(bytes);
  assert.deepEqual(parsed, { coordinatorIdentity: 'coord-1' });
  assert.equal(parseCoordinatorRolePayload(JSON.stringify({ type: 'other' })), null);
});

test('UI wording requires invitation link + access code; meeting ID is reference-only', async () => {
  const workspace = await readFile(path.join(root, 'components/media/RoomWorkspace.jsx'), 'utf8');
  const joinForm = await readFile(path.join(root, 'components/rooms/JoinRoomForm.jsx'), 'utf8');

  assert.match(workspace, /Copy invite link/);
  assert.match(workspace, /Copy meeting ID/);
  assert.doesNotMatch(workspace, /Copy room code/);
  assert.match(workspace, /The meeting ID is for reference only/);
  assert.match(workspace, /Invitation link \+ access code are required to join/);
  assert.match(workspace, /coordinator-promotion-toast/);
  assert.match(workspace, /You are now the coordinator for this meeting/);
  assert.match(workspace, /COORDINATOR_ROLE_DATA_TOPIC/);

  assert.match(joinForm, /Invitation link \+ access code are required to join/);
  assert.match(joinForm, /meeting ID alone cannot authorize entry/i);
  assert.match(joinForm, /rejoinToken/);
  assert.match(joinForm, /Meeting ID \(reference only\)/);
});

test('SharedPromptEditor wires focus/blur/idle editing presence', async () => {
  const source = await readFile(path.join(root, 'components/prompt/SharedPromptEditor.jsx'), 'utf8');
  assert.match(source, /setEditing/);
  assert.match(source, /onFocus/);
  assert.match(source, /onBlur/);
  assert.match(source, /EDITING_IDLE_MS/);
  assert.match(source, /markEditingActive/);
});
