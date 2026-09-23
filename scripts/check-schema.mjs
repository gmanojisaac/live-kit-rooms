import 'dotenv/config';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const res = await fetch(`${url}/rest/v1/`, {
  headers: {
    apikey: service,
    Authorization: `Bearer ${service}`,
    Accept: 'application/openapi+json',
  },
});

const text = await res.text();
const wanted = ['rooms', 'room_invites', 'prompt_documents', 'prompt_versions', 'audit_events'];
const present = wanted.filter((t) => text.includes(`/${t}`));
console.log(`openapi_status=${res.status}`);
console.log(`wanted_present=${present.length ? present.join(',') : '(none)'}`);
console.log(`host=${new URL(url).host}`);
