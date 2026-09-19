import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { createApp } from './server/app.js';
import { createAdmissionStore } from './server/admissions.js';

const port = Number(process.env.PORT || 3001);
const admissions = createAdmissionStore(fileURLToPath(new URL('./.data/admissions.json', import.meta.url)));
// Run one application server. Tailscale Serve forwards private HTTPS to loopback.
createApp({ admissions }).listen(port, '127.0.0.1', () => console.log('App server running on http://127.0.0.1:' + port));