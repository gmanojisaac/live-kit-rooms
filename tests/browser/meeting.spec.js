import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { RoomServiceClient } from 'livekit-server-sdk';

test('private invitation copy, clipboard fallback, and localhost guidance', async ({ browser, request }) => {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  // A routed test origin verifies HTTPS invitations without hosting anything publicly.
  await page.route('https://room-test.invalid/**', async route => {
    const target = new URL(route.request().url());
    const response = await request.get('http://127.0.0.1:4174' + target.pathname);
    await route.fulfill({ response });
  });
  await page.goto('https://room-test.invalid/?token=must-not-copy&accessCode=must-not-copy#secret');
  await page.getByRole('button', { name: 'Copy Invitation Link' }).click();
  await expect(page.getByRole('status')).toContainText('Invitation link copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://room-test.invalid/');
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  });
  await page.getByRole('button', { name: 'Copy Invitation Link' }).click();
  await expect(page.getByLabel('Invitation link', { exact: true })).toHaveValue('https://room-test.invalid/');
  await page.goto('http://127.0.0.1:4174');
  await page.getByRole('button', { name: 'Copy Invitation Link' }).click();
  await expect(page.getByRole('status')).toContainText('private HTTPS address');
  await context.close();
});

test('two real LiveKit connections exchange media, share together, focus, recover, and enforce the cap', async ({ browser, request }) => {
  test.skip(!process.env.LIVEKIT_API_SECRET || process.env.LIVEKIT_API_SECRET === 'replace_me', 'Requires the existing configured LiveKit project.');
  const service = new RoomServiceClient(process.env.LIVEKIT_URL.replace('wss:', 'https:').replace('ws:', 'http:'),
    process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
  const contexts = [];
  let roomName;
  const pageErrors = [];
  try {
    // Reserve both seats before connection; a third pending join must also be rejected.
    const tickets = await Promise.all(['Alice test', 'Bob test'].map(async name => {
      const response = await request.post('/api/join', { data: { name, accessCode: process.env.ROOM_ACCESS_CODE } });
      expect(response.status()).toBe(200);
      return response.json();
    }));
    roomName = tickets[0].roomName;
    const pendingFull = await request.post('/api/join', { data: { name: 'Third pending', accessCode: process.env.ROOM_ACCESS_CODE } });
    expect(pendingFull.status()).toBe(409);
    expect((await service.listRooms([roomName]))[0].maxParticipants).toBe(2);

    async function participant(name, ticket) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['camera', 'microphone'] });
      contexts.push(context);
      await context.addInitScript(() => {
        // Synthetic screens keep the host's real display private; LiveKit transport remains real.
        window.testPeers = [];
        const OriginalPeer = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends OriginalPeer {
          constructor(...args) { super(...args); window.testPeers.push(this); }
        };
        navigator.mediaDevices.getDisplayMedia = async () => {
          if (window.denyTestCapture) throw new DOMException('Permission denied', 'NotAllowedError');
          const canvas = document.createElement('canvas');
          canvas.width = 1280;
          canvas.height = 720;
          const painter = canvas.getContext('2d');
          const timer = setInterval(() => {
            painter.fillStyle = '#245ca6';
            painter.fillRect(0, 0, 1280, 720);
            painter.fillStyle = '#ffffff';
            painter.font = '48px sans-serif';
            painter.fillText('Synthetic shared screen ' + Date.now(), 40, 120);
          }, 100);
          const stream = canvas.captureStream(10);
          stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
          return stream;
        };
      });
      const page = await context.newPage();
      page.on('pageerror', error => pageErrors.push(error.message));
      if (ticket) await page.route('**/api/join', route => route.fulfill({ json: ticket }));
      await page.goto('/');
      await page.getByLabel('Your name').fill(name);
      await page.getByLabel('Room access code', { exact: true }).fill(process.env.ROOM_ACCESS_CODE);
      await page.getByRole('button', { name: 'Join room', exact: true }).click();
      return page;
    }

    const alice = await participant('Alice test', tickets[0]);
    const bob = await participant('Bob test', tickets[1]);
    for (const page of [alice, bob]) {
      await expect(page.getByText('2 / 2 participants', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Camera', exact: true }).click();
      await page.getByRole('button', { name: 'Microphone', exact: true }).click();
      await page.getByRole('button', { name: 'Share screen', exact: true }).click();
    }
    for (const page of [alice, bob]) {
      await expect(page.locator('.screen-tile:visible')).toHaveCount(2);
      await expect.poll(() => page.locator('.screen-tile video').evaluateAll(videos =>
        videos.filter(video => video.videoWidth > 0 && video.readyState >= 2).length)).toBe(2);
      await expect.poll(() => page.locator('.camera-grid video').evaluateAll(videos =>
        videos.filter(video => video.videoWidth > 0 && video.readyState >= 2).length)).toBe(2);
      await expect.poll(() => page.evaluate(async () => {
        let bytes = 0;
        for (const peer of window.testPeers) {
          if (peer.connectionState === 'closed') continue;
          const stats = await peer.getStats();
          stats.forEach(stat => {
            if (stat.type === 'inbound-rtp' && stat.kind === 'audio') bytes += stat.bytesReceived || 0;
          });
        }
        return bytes;
      })).toBeGreaterThan(0);
      const boxes = await page.locator('.screen-tile').evaluateAll(tiles =>
        tiles.map(tile => { const box = tile.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width }; }));
      expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(2);
      expect(boxes[1].x).toBeGreaterThan(boxes[0].x + boxes[0].width);
    }
    await alice.screenshot({ path: 'test-results/two-screens.png' });
    for (const name of ['Alice test', 'Bob test']) {
      await alice.getByRole('button', { name: "Maximize " + name + "'s screen", exact: true }).click();
      await expect(alice.locator('.screen-tile:visible')).toHaveCount(1);
      await alice.getByRole('button', { name: 'Return to grid' }).click();
      await expect(alice.locator('.screen-tile:visible')).toHaveCount(2);
    }
    await alice.getByRole('button', { name: "Maximize Bob test's screen", exact: true }).click();
    await bob.getByRole('button', { name: 'Stop screen share', exact: true }).click();
    await expect(alice.getByRole('button', { name: 'Return to grid' })).toHaveCount(0);
    await expect(alice.locator('.screen-tile:visible')).toHaveCount(1);
    await bob.evaluate(() => { window.denyTestCapture = true; });
    await bob.getByRole('button', { name: 'Share screen', exact: true }).click();
    await expect(bob.getByRole('alert')).toContainText('Permission was denied');
    await bob.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await bob.evaluate(() => { window.denyTestCapture = false; });
    await bob.getByRole('button', { name: 'Share screen', exact: true }).click();
    await expect(alice.locator('.screen-tile:visible')).toHaveCount(2);

    const full = await request.post('/api/join', { data: { name: 'Third', accessCode: process.env.ROOM_ACCESS_CODE } });
    expect(full.status()).toBe(409);
    const third = await participant('Third test');
    await expect(third.getByRole('alert')).toBeVisible();
    expect((await service.listParticipants(roomName)).length).toBe(2);
    await third.context().close();

    const release = bob.waitForResponse(response => response.url().endsWith('/api/leave'));
    await bob.getByRole('button', { name: 'Leave', exact: true }).click();
    expect((await release).status()).toBe(204);
    await expect(alice.getByText('1 / 2 participants', { exact: true })).toBeVisible();
    const replacement = await participant('Replacement test');
    await expect(replacement.getByText('2 / 2 participants', { exact: true })).toBeVisible();
    await expect(alice.getByText('2 / 2 participants', { exact: true })).toBeVisible();
    const stale = await participant('Old token test', tickets[1]);
    await expect(stale.getByRole('alert')).toBeVisible();
    expect((await service.listParticipants(roomName)).length).toBe(2);
    expect(pageErrors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    if (roomName?.startsWith('collaborative-room-verification-')) await service.deleteRoom(roomName);
  }
});