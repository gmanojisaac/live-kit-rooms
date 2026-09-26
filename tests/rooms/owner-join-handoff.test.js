import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OWNER_JOIN_HANDOFF_KEY,
  OWNER_JOIN_HANDOFF_MAX_AGE_MS,
  clearOwnerJoinHandoff,
  readOwnerJoinHandoff,
  saveOwnerJoinHandoff,
} from '../../lib/rooms/owner-join-handoff.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

const handoff = {
  slug: 'abc123',
  displayName: '  Akshay   ',
  accessCode: 'owner-access-code',
};

test('owner handoff stores the name and access code for the created room', () => {
  const storage = memoryStorage();
  assert.equal(saveOwnerJoinHandoff(handoff, storage, () => 1_000), true);
  assert.deepEqual(
    readOwnerJoinHandoff('abc123', storage, () => 1_000),
    { displayName: 'Akshay', accessCode: 'owner-access-code' },
  );
});

test('owner handoff preserves creator join token when provided', () => {
  const storage = memoryStorage();
  assert.equal(saveOwnerJoinHandoff({
    ...handoff,
    ownerJoinToken: 'signed.creator.join.token',
  }, storage, () => 1_000), true);
  assert.deepEqual(
    readOwnerJoinHandoff('abc123', storage, () => 1_000),
    {
      displayName: 'Akshay',
      accessCode: 'owner-access-code',
      ownerJoinToken: 'signed.creator.join.token',
    },
  );
});

test('owner handoff is ignored for a different room', () => {
  const storage = memoryStorage();
  saveOwnerJoinHandoff(handoff, storage, () => 1_000);
  assert.equal(readOwnerJoinHandoff('other-room', storage, () => 1_000), null);
  assert.ok(storage.getItem(OWNER_JOIN_HANDOFF_KEY));
});

test('expired owner handoff is cleared', () => {
  const storage = memoryStorage();
  saveOwnerJoinHandoff(handoff, storage, () => 1_000);
  assert.equal(
    readOwnerJoinHandoff('abc123', storage, () => 1_000 + OWNER_JOIN_HANDOFF_MAX_AGE_MS + 1),
    null,
  );
  assert.equal(storage.getItem(OWNER_JOIN_HANDOFF_KEY), null);
});

test('owner handoff rejects a missing name or short access code', () => {
  const storage = memoryStorage();
  assert.equal(saveOwnerJoinHandoff({ ...handoff, displayName: '   ' }, storage), false);
  assert.equal(saveOwnerJoinHandoff({ ...handoff, accessCode: 'short' }, storage), false);
  assert.equal(storage.getItem(OWNER_JOIN_HANDOFF_KEY), null);
});

test('clearOwnerJoinHandoff removes stored credentials', () => {
  const storage = memoryStorage();
  saveOwnerJoinHandoff(handoff, storage, () => 1_000);
  clearOwnerJoinHandoff(storage);
  assert.equal(readOwnerJoinHandoff('abc123', storage, () => 1_000), null);
});
