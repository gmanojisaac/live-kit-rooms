import Link from 'next/link';
import { cookies } from 'next/headers';
import { getRoomBySlug } from '@/lib/rooms/lookup.js';
import { createRoomRepository } from '@/lib/rooms/repository.js';
import { verifyOwnerSession, OWNER_SESSION_COOKIE } from '@/lib/security/owner-session.js';
import { getRoomPolicy } from '@/lib/rooms/policy.js';
import { toPublicRoom } from '@/lib/rooms/status.js';
import { ensureRoomNotStaleActive } from '@/lib/rooms/owner-auth.js';
import { PromptPlaceholder } from '@/components/prompt/PromptPlaceholder';
import JoinRoomForm from '@/components/rooms/JoinRoomForm';
import OwnerModerationPanel from '@/components/rooms/OwnerModerationPanel';
import LiveMeetHeader from '@/components/media/LiveMeetHeader';

export const dynamic = 'force-dynamic';

async function loadRoomForPage(slug) {
  const repository = createRoomRepository();
  const result = await getRoomBySlug(slug, { repository, includeSensitive: true });

  if (!result.ok) {
    return {
      ok: false,
      error: result.reason === 'ROOM_NOT_FOUND' || result.reason === 'INVALID_SLUG'
        ? 'Room not found.'
        : 'Unable to load room.',
    };
  }

  await ensureRoomNotStaleActive(result.room, repository);
  const refreshed = await repository.getRoomById(result.room.id);
  const promptDoc = refreshed
    ? await repository.getPromptDocument(refreshed.id)
    : null;

  let isOwner = false;
  try {
    const policy = getRoomPolicy();
    const cookieStore = cookies();
    const token = cookieStore.get(OWNER_SESSION_COOKIE)?.value;
    if (token && policy.ownerSessionSecret) {
      const session = verifyOwnerSession(token, policy.ownerSessionSecret);
      isOwner = Boolean(session?.ownerId && session.ownerId === refreshed.owner_id);
    }
  } catch {
    isOwner = false;
  }

  const publicRoom = toPublicRoom(refreshed, {
    isOwner,
    promptLocked: Boolean(promptDoc?.is_locked),
  });

  return { ok: true, room: publicRoom };
}

export default async function RoomPage({ params, searchParams }) {
  const slug = params?.slug || '';
  const inviteToken = typeof searchParams?.invite === 'string' ? searchParams.invite : '';

  let room = null;
  let lookupError = null;
  try {
    const result = await loadRoomForPage(slug);
    if (result.ok) {
      room = result.room;
    } else {
      lookupError = result.error;
    }
  } catch {
    lookupError = 'Unable to load room.';
  }

  const inactive = room?.status === 'ended' || room?.status === 'expired';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <LiveMeetHeader />
      <main className="room-page">
        <p className="eyebrow" style={{ display: 'none' }}>
          <Link href="/">Home</Link>
          {' · '}
          <Link href="/create">Create room</Link>
        </p>

        {lookupError ? (
          <div className="gm-create-card" style={{ maxWidth: '480px', margin: '3rem auto', textAlign: 'center' }}>
            <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Meeting Not Found</h1>
            <p role="alert" className="error">{lookupError}</p>
            <Link href="/" className="gm-btn-primary" style={{ margin: '1rem auto 0', display: 'inline-flex' }}>
              Return to Home
            </Link>
          </div>
        ) : (
          <>
            <h1 style={{ display: 'none' }}>{room?.title || 'Room'}</h1>
            <p style={{ display: 'none' }}>
              Room <code>{room.slug}</code>
              {room.status ? ` · ${room.status}` : ''}
              {room.expiresAt ? ` · expires ${new Date(room.expiresAt).toLocaleString()}` : ''}
              {room.promptLocked ? ' · prompt locked' : ''}
            </p>

            {room.isOwner || room.isCoordinator ? (
              <details className="gm-owner-accordion">
                <summary>Coordinator moderation controls</summary>
                <div className="gm-owner-accordion__body">
                  <OwnerModerationPanel slug={room.slug} initialRoom={room} />
                </div>
              </details>
            ) : null}

            {!inactive ? (
              <section className="join-section">
                <h2 style={{ display: 'none' }}>Join</h2>
                <p className="hint" style={{ display: 'none' }}>
                  Enter your display name and the access code provided separately from the invitation link.
                </p>
                <JoinRoomForm
                  slug={room.slug}
                  inviteToken={inviteToken}
                  roomMeta={room}
                />
              </section>
            ) : (
              <div className="gm-create-card" style={{ maxWidth: '480px', margin: '3rem auto' }}>
                <h2>Meeting Ended</h2>
                <p className="hint" role="status">
                  This room is {room.status}. New joins are closed and the prompt workspace is read-only.
                </p>
                <div className="panel-stack">
                  <PromptPlaceholder slug={room.slug} readOnlyHint />
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
