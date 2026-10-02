/**
 * Fixed team roster (TEAM_MEMBERS env). When configured, participants pick
 * their name from this list instead of typing a free-form display name, so
 * saved prompts and result images are attributed to a stable name.
 * This is attribution, not authentication — the invite link + access code
 * remain the only admission credentials.
 */

import { normalizeDisplayName } from './display-name.js';

/** Matches the room capacity (policy.js MAX_PARTICIPANTS); kept local to avoid an import cycle. */
export const MAX_TEAM_MEMBERS = 6;

/**
 * Parse a comma-separated roster into unique, normalized display names.
 * @returns {string[]}
 */
export function parseTeamMembers(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const members = [];
  const seen = new Set();
  for (const part of raw.split(',')) {
    const check = normalizeDisplayName(part);
    if (!check.ok) continue;
    const key = check.displayName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    members.push(check.displayName);
    if (members.length >= MAX_TEAM_MEMBERS) break;
  }
  return members;
}

/**
 * Resolve a submitted name to its canonical roster spelling.
 * @returns {string|null}
 */
export function matchTeamMember(name, members) {
  if (!Array.isArray(members) || members.length === 0) return null;
  const check = normalizeDisplayName(name);
  if (!check.ok) return null;
  const key = check.displayName.toLowerCase();
  return members.find((member) => member.toLowerCase() === key) || null;
}

export function getTeamMembers(env = process.env) {
  return parseTeamMembers(env.TEAM_MEMBERS);
}
