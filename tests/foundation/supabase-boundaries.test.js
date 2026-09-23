import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+['"][^'"]*lib\/supabase\/admin['"]/,
  /from\s+['"]@\/lib\/supabase\/admin['"]/,
  /createServiceRoleSupabaseClient/,
];

async function collectSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(full));
    } else if (/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

test('client UI modules do not import service-role Supabase access', async () => {
  const scopes = [
    path.join(root, 'app'),
    path.join(root, 'components'),
    path.join(root, 'lib', 'supabase', 'browser.js'),
  ];

  const files = [];
  for (const scope of scopes) {
    const statPath = scope;
    try {
      files.push(...(scope.endsWith('.js') ? [statPath] : await collectSourceFiles(statPath)));
    } catch (error) {
      assert.fail(`Missing expected path: ${scope} (${error.message})`);
    }
  }

  const violations = [];
  for (const file of files) {
    const normalized = file.replace(/\\/g, '/');
    if (normalized.includes('/lib/supabase/admin.')) continue;
    // Route Handlers and server-only modules may use the service role via lib/.
    if (normalized.includes('/app/api/')) continue;
    const source = await readFile(file, 'utf8');
    // Skip Server Components that only compose UI; still forbid direct admin imports.
    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      if (pattern.test(source)) {
        violations.push(`${path.relative(root, file)} matches ${pattern}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('service-role module refuses browser execution', async () => {
  const { createServiceRoleSupabaseClient } = await import('../../lib/supabase/admin.js');
  const previous = globalThis.window;
  globalThis.window = {};
  try {
    assert.throws(
      () => createServiceRoleSupabaseClient({
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      }),
      /must not run in the browser/,
    );
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
