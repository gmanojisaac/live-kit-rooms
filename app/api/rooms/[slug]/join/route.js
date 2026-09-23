import { NextResponse } from 'next/server';
import { handleJoinPost } from '../../../../../lib/rooms/join-handler.js';

export const dynamic = 'force-dynamic';

export { __resetJoinLimiterForTests } from '../../../../../lib/rooms/join-handler.js';

/**
 * POST /api/rooms/[slug]/join — participant admission + LiveKit JWT (AUTH-03 / AUTH-04).
 */
export async function POST(request, context) {
  const result = await handleJoinPost(request, context);
  const response = NextResponse.json(result.body, { status: result.status });
  for (const [key, value] of Object.entries(result.headers || {})) {
    response.headers.set(key, value);
  }
  return response;
}
