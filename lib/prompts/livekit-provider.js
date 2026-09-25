/**
 * Yjs ↔ LiveKit Data Channels provider (COL-01 Option A).
 *
 * Auth boundary: only LiveKit room members (JWT-admitted) can publish/receive.
 * Room isolation: LiveKit room name === app room slug.
 * Late join: sync step1/step2 via y-protocols; optional snapshot seed by caller.
 * Reconnect: re-run sync after LiveKit reconnect; CRDT merges, no LWW overwrite.
 */

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { RoomEvent } from 'livekit-client';
import {
  YJS_SYNC_TOPIC,
  YJS_UPDATE_TOPIC,
  YJS_AWARENESS_TOPIC,
  PROMPT_META_TOPIC,
} from './constants.js';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

function toUint8(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data);
}

/**
 * @param {object} options
 * @param {import('livekit-client').Room} options.room
 * @param {Y.Doc} options.doc
 * @param {string} options.displayName
 * @param {string} [options.participantIdentity]
 * @param {boolean} [options.readOnly]
 */
export function createLiveKitYjsProvider({
  room,
  doc,
  displayName,
  participantIdentity = '',
  readOnly = false,
}) {
  const awareness = new awarenessProtocol.Awareness(doc);
  let destroyed = false;
  let synced = false;
  let readOnlyFlag = Boolean(readOnly);
  const listeners = new Set();

  function emit(event, payload) {
    for (const listener of listeners) {
      try {
        listener(event, payload);
      } catch {
        // never break the provider on UI listener errors
      }
    }
  }

  function on(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function setReadOnly(next) {
    readOnlyFlag = Boolean(next);
    emit('readonly', { readOnly: readOnlyFlag });
  }

  function publish(topic, bytes, { destinationIdentities } = {}) {
    if (destroyed || !room?.localParticipant) return;
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const opts = { reliable: true, topic };
    if (destinationIdentities?.length) {
      opts.destinationIdentities = destinationIdentities;
    }
    room.localParticipant.publishData(data, opts).catch(() => {
      emit('connection', { state: 'publish-failed' });
    });
  }

  function broadcastSyncStep1() {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    publish(YJS_SYNC_TOPIC, encoding.toUint8Array(encoder));
  }

  function broadcastUpdate(update, origin) {
    if (origin === 'remote' || origin === 'server-snapshot' || origin === 'server-yjs-state') {
      return;
    }
    if (readOnlyFlag) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    publish(YJS_UPDATE_TOPIC, encoding.toUint8Array(encoder));
  }

  function broadcastAwareness(changedClients = [doc.clientID]) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
    );
    publish(YJS_AWARENESS_TOPIC, encoding.toUint8Array(encoder));
  }

  function handleSyncMessage(bytes, fromIdentity) {
    const decoder = decoding.createDecoder(bytes);
    const msgType = decoding.readVarUint(decoder);
    if (msgType !== MSG_SYNC) return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    const syncMessageType = syncProtocol.readSyncMessage(decoder, encoder, doc, 'remote');
    if (encoding.length(encoder) > 1) {
      publish(YJS_SYNC_TOPIC, encoding.toUint8Array(encoder), {
        destinationIdentities: fromIdentity ? [fromIdentity] : undefined,
      });
    }
    if (
      syncMessageType === syncProtocol.messageYjsSyncStep2
      || syncMessageType === syncProtocol.messageYjsUpdate
    ) {
      if (!synced) {
        synced = true;
        emit('synced', { fromIdentity });
      }
    }
  }

  function handleAwarenessMessage(bytes) {
    const decoder = decoding.createDecoder(bytes);
    const msgType = decoding.readVarUint(decoder);
    if (msgType !== MSG_AWARENESS) return;
    const update = decoding.readVarUint8Array(decoder);
    awarenessProtocol.applyAwarenessUpdate(awareness, update, 'remote');
  }

  function onDataReceived(payload, participant, _kind, topic) {
    if (destroyed) return;
    const bytes = toUint8(payload);
    const fromIdentity = participant?.identity || '';
    if (topic === YJS_SYNC_TOPIC || topic === YJS_UPDATE_TOPIC || !topic) {
      try {
        handleSyncMessage(bytes, fromIdentity);
      } catch {
        emit('connection', { state: 'sync-error' });
      }
      return;
    }
    if (topic === YJS_AWARENESS_TOPIC) {
      try {
        handleAwarenessMessage(bytes);
      } catch {
        emit('connection', { state: 'awareness-error' });
      }
      return;
    }
    if (topic === PROMPT_META_TOPIC) {
      try {
        const text = new TextDecoder().decode(bytes);
        const meta = JSON.parse(text);
        if (meta && typeof meta === 'object') {
          emit('meta', meta);
          if (typeof meta.locked === 'boolean') {
            setReadOnly(meta.locked || meta.roomStatus === 'ended' || meta.roomStatus === 'expired');
          }
        }
      } catch {
        // ignore malformed meta
      }
    }
  }

  function onDocUpdate(update, origin) {
    broadcastUpdate(update, origin);
  }

  function onAwarenessChange({ added, updated, removed }, origin) {
    if (origin === 'local') {
      const changed = added.concat(updated, removed);
      if (changed.length) broadcastAwareness(changed);
    }
    emit('awareness', { states: getEditingPresence(awareness) });
  }

  function publishMeta(meta) {
    if (destroyed || !room?.localParticipant) return;
    const bytes = new TextEncoder().encode(JSON.stringify(meta));
    publish(PROMPT_META_TOPIC, bytes);
  }

  // Initial local awareness — connected ≠ editing
  awareness.setLocalStateField('user', {
    name: displayName || 'Participant',
    identity: participantIdentity || room?.localParticipant?.identity || '',
    editing: false,
  });

  function setEditing(isEditing) {
    if (destroyed) return;
    const identity = participantIdentity || room?.localParticipant?.identity || '';
    awareness.setLocalStateField('user', {
      name: displayName || 'Participant',
      identity,
      editing: Boolean(isEditing),
    });
  }

  doc.on('update', onDocUpdate);
  awareness.on('change', onAwarenessChange);
  room.on(RoomEvent.DataReceived, onDataReceived);

  const onConnected = () => {
    emit('connection', { state: 'connected' });
    synced = false;
    broadcastSyncStep1();
    broadcastAwareness();
  };

  const onReconnecting = () => {
    emit('connection', { state: 'reconnecting' });
  };

  const onDisconnected = () => {
    emit('connection', { state: 'disconnected' });
  };

  room.on(RoomEvent.Connected, onConnected);
  room.on(RoomEvent.Reconnecting, onReconnecting);
  room.on(RoomEvent.Disconnected, onDisconnected);

  if (room.state === 'connected') {
    onConnected();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    awareness.setLocalState(null);
    doc.off('update', onDocUpdate);
    awareness.off('change', onAwarenessChange);
    room.off(RoomEvent.DataReceived, onDataReceived);
    room.off(RoomEvent.Connected, onConnected);
    room.off(RoomEvent.Reconnecting, onReconnecting);
    room.off(RoomEvent.Disconnected, onDisconnected);
    awareness.destroy();
    listeners.clear();
  }

  return {
    awareness,
    doc,
    on,
    destroy,
    setReadOnly,
    setEditing,
    getReadOnly: () => readOnlyFlag,
    isSynced: () => synced,
    markSynced: () => {
      synced = true;
    },
    requestSync: broadcastSyncStep1,
    publishMeta,
    getEditingPresence: () => getEditingPresence(awareness),
  };
}

/**
 * Active editor display names from awareness (no private ids required in UI).
 */
export function getEditingPresence(awareness) {
  const names = [];
  const seen = new Set();
  awareness.getStates().forEach((state) => {
    const user = state?.user;
    if (!user?.editing) return;
    const name = typeof user.name === 'string' && user.name.trim()
      ? user.name.trim().slice(0, 40)
      : 'Participant';
    const key = `${user.identity || ''}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  });
  return names;
}

export { awarenessProtocol, Y };
