#!/usr/bin/env node

/**
 * T214 of `ee/plans/2026-11-21-itil-remediation` on a real production build.
 *
 * A new ITIL board gets its ITIL Standard SLA policy from a hook that startup registers. The hook
 * is held on `globalThis` because Next builds separate module instances for startup code and for
 * server actions — the double-bundle unit test is the fast proof of that, and this is the slow
 * one: against a built, started server, create an ITIL board through the `createBoard` server
 * action and through `POST /api/v1/boards` without rendering a single MSP page, and check that
 * both boards come out with an SLA policy.
 *
 * Usage:
 *   npm run build                       # production build
 *   (cd server && next start -p 3116)   # with NEXTAUTH_URL pointing at that port
 *   ALGA_BASE_URL=http://localhost:3116 ALGA_EMAIL=… ALGA_PASSWORD=… \
 *     [ALGA_API_KEY=…] node scripts/check-itil-sla-on-production-build.mjs
 *
 * Without `ALGA_API_KEY` the REST half is skipped and said so; the server-action half always runs.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE_URL = (process.env.ALGA_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const EMAIL = process.env.ALGA_EMAIL;
const PASSWORD = process.env.ALGA_PASSWORD;
const API_KEY = process.env.ALGA_API_KEY;
const NEXT_DIR = resolve(process.env.ALGA_NEXT_DIR ?? 'server/.next');

if (!EMAIL || !PASSWORD) {
  console.error('[itil-sla-production] ALGA_EMAIL and ALGA_PASSWORD are required');
  process.exit(2);
}

/** The action id the client bundle registers for an exported server action, by its name. */
function serverActionId(exportName) {
  const chunks = join(NEXT_DIR, 'static/chunks');
  if (!existsSync(chunks)) throw new Error(`No production build at ${NEXT_DIR} — run npm run build first`);
  const pattern = new RegExp(String.raw`createServerReference\)\("([a-f0-9]+)"[^)]*?"${exportName}"\)`);
  for (const entry of readdirSync(chunks, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const match = pattern.exec(readFileSync(join(chunks, entry.name), 'utf8'));
    if (match) return match[1];
  }
  throw new Error(`No server-action id found for ${exportName}`);
}

/** A route that may run this action and is not an MSP page: the whole point of the check. */
function nonMspRouteFor(actionId) {
  const manifest = JSON.parse(readFileSync(join(NEXT_DIR, 'server/server-reference-manifest.json'), 'utf8'));
  const entry = manifest.node?.[actionId];
  if (!entry) throw new Error(`Action ${actionId} is not in the server reference manifest`);
  const route = Object.keys(entry.workers).find((name) => !name.startsWith('app/msp'));
  if (!route) throw new Error(`Action ${actionId} runs only on MSP routes`);
  return `/${route.replace(/^app/, '').replace(/\/page$/, '')}`.replace('//', '/');
}

const cookies = new Map();
function cookieHeader() {
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}
function rememberCookies(response) {
  for (const line of response.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';');
    const index = pair.indexOf('=');
    if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
}

async function signIn() {
  const csrfResponse = await fetch(`${BASE_URL}/api/auth/csrf`);
  rememberCookies(csrfResponse);
  const { csrfToken } = await csrfResponse.json();
  const body = new URLSearchParams({
    csrfToken,
    email: EMAIL,
    password: PASSWORD,
    userType: 'internal',
    callbackUrl: `${BASE_URL}/msp/tickets`,
  });
  const response = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader() },
    body,
  });
  rememberCookies(response);
  const session = await (await fetch(`${BASE_URL}/api/auth/session`, { headers: { Cookie: cookieHeader() } })).json();
  if (!session?.user?.id) throw new Error('Sign-in failed: no session user');
  return session.user;
}

async function callAction(actionId, route, args) {
  const response = await fetch(`${BASE_URL}${route}`, {
    method: 'POST',
    headers: {
      'Next-Action': actionId,
      'Content-Type': 'text/plain;charset=UTF-8',
      Cookie: cookieHeader(),
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Action ${actionId} failed with ${response.status}`);
  return text;
}

/**
 * The board object out of the flight response: the key order is the row's, so the object is found
 * by a key it must carry and then bounded by its own braces in both directions.
 */
function boardFrom(text) {
  const marker = text.lastIndexOf('"sla_policy_id"');
  if (marker === -1) throw new Error('No board in the action result');
  let depth = 0;
  let start = -1;
  for (let i = marker; i >= 0; i -= 1) {
    if (text[i] === '}') depth += 1;
    else if (text[i] === '{') {
      if (depth === 0) {
        start = i;
        break;
      }
      depth -= 1;
    }
  }
  if (start === -1) throw new Error('No board in the action result');
  depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('Unterminated board in the action result');
}

const failures = [];
const name = (what) => `T214 ${what} ${new Date().toISOString().slice(11, 19)}`;

const user = await signIn();
console.log(`[itil-sla-production] signed in as ${user.email} (no MSP page rendered)`);

const createId = serverActionId('createBoard');
const deleteId = serverActionId('deleteBoard');
const route = nonMspRouteFor(createId);
console.log(`[itil-sla-production] createBoard=${createId} through ${route}`);

const actionBoard = boardFrom(
  await callAction(createId, route, [
    { board_name: name('action'), category_type: 'itil', priority_type: 'itil', is_default: false, is_inactive: false },
  ])
);
console.log(`[itil-sla-production] server action → board ${actionBoard.board_id} sla_policy_id=${actionBoard.sla_policy_id}`);
if (!actionBoard.sla_policy_id) failures.push('the server action created an ITIL board with no SLA policy');

let restBoardId = null;
if (API_KEY) {
  const response = await fetch(`${BASE_URL}/api/v1/boards`, {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ board_name: name('rest'), category_type: 'itil', priority_type: 'itil' }),
  });
  const payload = await response.json();
  if (!response.ok) {
    failures.push(`POST /api/v1/boards answered ${response.status}: ${JSON.stringify(payload)}`);
  } else {
    const board = payload?.data ?? payload;
    restBoardId = board?.board_id ?? null;
    console.log(`[itil-sla-production] REST → board ${restBoardId} sla_policy_id=${board?.sla_policy_id}`);
    if (!board?.sla_policy_id) failures.push('POST /api/v1/boards created an ITIL board with no SLA policy');
  }
} else {
  console.log('[itil-sla-production] REST half skipped: no ALGA_API_KEY');
}

// Cleanup: `force` is needed because an ITIL board owns its statuses and its category set. The
// answer is printed either way — a board this check leaves behind is for a human to remove.
for (const boardId of [actionBoard.board_id, restBoardId].filter(Boolean)) {
  const result = String(await callAction(deleteId, route, [boardId, true, true]).catch((error) => error.message));
  const answer = result.slice(result.lastIndexOf('{"success"'), result.lastIndexOf('{"success"') + 160);
  console.log(`[itil-sla-production] delete ${boardId}: ${answer || result.slice(-160)}`);
}

if (failures.length > 0) {
  console.error('[itil-sla-production] FAILED:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('[itil-sla-production] OK: a new ITIL board gets its SLA policy on a production build.');
