import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function exists(relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

test('target foundation routes and placeholders exist', async () => {
  const required = [
    'app/layout.jsx',
    'app/(public)/page.jsx',
    'app/create/page.jsx',
    'app/room/[slug]/page.jsx',
    'app/api/rooms/route.js',
    'app/api/rooms/[slug]/route.js',
    'app/api/rooms/[slug]/join/route.js',
    'app/api/rooms/[slug]/lock/route.js',
    'app/api/rooms/[slug]/remove/route.js',
    'app/api/rooms/[slug]/revoke-invite/route.js',
    'app/api/rooms/[slug]/end/route.js',
    'app/api/rooms/[slug]/participants/route.js',
    'app/api/rooms/[slug]/transfer-coordinator/route.js',
    'app/api/rooms/[slug]/claim-coordinator/route.js',
    'app/api/rooms/[slug]/prompt/route.js',
    'app/api/rooms/[slug]/prompt/finalize/route.js',
    'app/api/join/route.js',
    'components/media/MediaPlaceholder.jsx',
    'components/media/MediaRoom.jsx',
    'components/media/RoomWorkspace.jsx',
    'components/media/ScreenShareGrid.jsx',
    'components/media/ScreenShareWarning.jsx',
    'components/media/ConnectionStatus.jsx',
    'components/media/FocusQualityController.jsx',
    'lib/media/connection-state.js',
    'lib/media/focus-state.js',
    'lib/media/quality-policy.js',
    'lib/media/room-options.js',
    'lib/media/screen-share-state.js',
    'lib/media/diagnostics.js',
    'components/prompt/PromptPlaceholder.jsx',
    'components/prompt/SharedPromptEditor.jsx',
    'components/prompt/CollaborativePromptEditor.jsx',
    'components/rooms/CreateRoomForm.jsx',
    'components/rooms/JoinRoomForm.jsx',
    'components/rooms/OwnerModerationPanel.jsx',
    'lib/livekit/config.js',
    'lib/livekit/token.js',
    'lib/livekit/rooms.js',
    'lib/security/server-only.js',
    'lib/security/access-code.js',
    'lib/security/invite-token.js',
    'lib/security/owner-session.js',
    'lib/security/rate-limit.js',
    'lib/rooms/service.js',
    'lib/rooms/join.js',
    'lib/rooms/join-handler.js',
    'lib/rooms/access-validation.js',
    'lib/rooms/owner-auth.js',
    'lib/rooms/moderation.js',
    'lib/rooms/coordinator-transfer.js',
    'lib/rooms/coordinator-transfer-client.js',
    'lib/prompts/service.js',
    'lib/prompts/yjs-doc.js',
    'lib/prompts/livekit-provider.js',
    'lib/prompts/constants.js',
    'lib/supabase/browser.js',
    'lib/supabase/server.js',
    'lib/supabase/admin.js',
    'lib/config/env.js',
  ];

  for (const file of required) {
    assert.equal(await exists(file), true, `missing ${file}`);
  }
});

test('room API implements creation; slug join issues tokens; legacy /api/join stays deferred', async () => {
  const roomsSource = await readFile(path.join(root, 'app/api/rooms/route.js'), 'utf8');
  const joinSource = await readFile(path.join(root, 'app/api/join/route.js'), 'utf8');
  const slugJoinSource = await readFile(path.join(root, 'app/api/rooms/[slug]/join/route.js'), 'utf8');

  assert.match(roomsSource, /export async function GET/);
  assert.match(roomsSource, /export async function POST/);
  assert.match(roomsSource, /createRoom/);
  assert.match(joinSource, /export async function POST/);
  assert.match(joinSource, /status:\s*501/);
  assert.match(joinSource, /not_implemented/);
  assert.match(slugJoinSource, /export async function POST/);
  assert.match(slugJoinSource, /handleJoinPost/);
  assert.match(slugJoinSource, /join-handler/);
});

test('supabase migrations exist and define required tables + RLS + phase2 status', async () => {
  const migrationsDir = path.join(root, 'supabase', 'migrations');
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  assert.ok(files.length >= 2, 'expected phase1 and phase2 migrations');

  const sql = (await Promise.all(
    files.map((name) => readFile(path.join(migrationsDir, name), 'utf8')),
  )).join('\n');

  for (const table of ['rooms', 'room_invites', 'prompt_documents', 'prompt_versions', 'audit_events', 'room_coordinator_transfers']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`), `missing table ${table}`);
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), `missing RLS on ${table}`);
  }

  assert.match(sql, /max_participants integer not null default 6/);
  assert.match(sql, /constraint prompt_versions_room_version_unique unique \(room_id, version_number\)/);
  assert.match(sql, /constraint rooms_slug_unique unique \(slug\)/);
  assert.match(sql, /rooms_status_allowed/);
  assert.match(sql, /try_consume_room_invite/);
  assert.match(sql, /is_locked/);
  assert.match(sql, /references public\.rooms/);
});

test('media helpers and Phase 3 docs exist', async () => {
  assert.equal(await exists('tests/media/media-helpers.test.js'), true);
  assert.equal(await exists('docs/testing/media-acceptance-checklist.md'), true);
  assert.equal(await exists('docs/testing/six-device-one-hour-template.md'), true);
  assert.equal(await exists('docs/testing/six-user-media-harness.md'), true);
  assert.equal(await exists('tests/prompts/yjs-crdt.test.js'), true);
  assert.equal(await exists('tests/prompts/prompt-service.test.js'), true);
  assert.equal(await exists('supabase/migrations/20260922020000_phase4_prompt_yjs_state.sql'), true);

  const meeting = await readFile(path.join(root, 'src/Meeting.jsx'), 'utf8');
  assert.doesNotMatch(meeting, /Both participants can share/);
  assert.match(meeting, /Up to six people can share/);

  const roomOptions = await readFile(path.join(root, 'lib/media/room-options.js'), 'utf8');
  assert.match(roomOptions, /adaptiveStream:\s*true/);
  assert.match(roomOptions, /dynacast:\s*true/);
});

test('prototype server tests are preserved', async () => {
  assert.equal(await exists('tests/server.test.js'), true);
  assert.equal(await exists('tests/browser/meeting.spec.js'), true);
  assert.equal(await exists('server/app.js'), true);
  assert.equal(await exists('src/main.jsx'), true);
});
