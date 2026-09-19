import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';

// Test an isolated, short-lived room in the SAME project; never join or delete the user's active room.
const roomName = 'collaborative-room-verification-' + randomUUID();
createApp({ roomName }).listen(4174, '127.0.0.1');