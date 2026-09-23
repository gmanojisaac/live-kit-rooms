import { NextResponse } from 'next/server';

/**
 * Placeholder: join + LiveKit token issuance after backend validation.
 * Secrets must remain server-only (see lib/config/env.js).
 */
export async function POST() {
  return NextResponse.json({
    status: 'not_implemented',
    phase: 1,
    message: 'Join and LiveKit token issuance will be migrated in a later phase.',
  }, { status: 501 });
}
