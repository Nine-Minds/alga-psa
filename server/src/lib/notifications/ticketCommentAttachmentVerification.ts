import { createHmac, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import type { AttachmentLinkClaims } from '@shared/lib/ticketCommentAttachmentToken';

const digest = (secret: string, value: string) => createHmac('sha256', secret).update(`attachment-verification:v1:${value}`).digest('hex');
const matches = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** No code is stored in plaintext; throttle by signed link and bind to this browser. */
export async function issueAttachmentChallenge(db: Knex, claims: AttachmentLinkClaims, token: string, secret: string,
  send: (code: string) => Promise<void>, now = Date.now()) {
  const browser = randomBytes(32).toString('base64url');
  const code = String(randomInt(100000, 1000000));
  const key = { tenant: claims.tenant, token_hash: digest(secret, token) };
  const issued = await withTransaction(db, async trx => {
    const table = () => tenantDb(trx, claims.tenant).table('ticket_comment_attachment_challenges');
    const data = { ...key, browser_hash: digest(secret, browser), code_hash: digest(secret, `${token}:${code}`),
      attempts: 0, expires_at: new Date(Math.min(claims.expiresAt, now + 10 * 60_000)), sent_at: new Date(now), consumed_at: null };
    const inserted = await table().insert(data).onConflict(['tenant', 'token_hash']).ignore().returning('token_hash');
    if (inserted.length) return true;
    return Boolean(await table().where(key).where('sent_at', '<=', new Date(now - 60_000)).update(data));
  });
  if (!issued || claims.expiresAt <= now) throw new Error('Please wait one minute before requesting another code.');
  await send(code);
  return browser;
}

export async function redeemAttachmentChallenge(db: Knex, claims: AttachmentLinkClaims, token: string, secret: string, browser: string, code: string, now = Date.now()) {
  if (!browser || !/^\d{6}$/.test(code) || claims.expiresAt <= now) return false;
  return withTransaction(db, async trx => {
    const table = () => tenantDb(trx, claims.tenant).table('ticket_comment_attachment_challenges');
    const key = { token_hash: digest(secret, token) };
    const row = await table().where(key).forUpdate().first();
    if (!row || row.consumed_at || row.attempts >= 5 || new Date(row.expires_at).getTime() <= now ||
      !matches(row.browser_hash, digest(secret, browser))) return false;
    const valid = matches(row.code_hash, digest(secret, `${token}:${code}`));
    await table().where(key).update({ attempts: row.attempts + 1, ...(valid ? { consumed_at: new Date(now) } : {}) });
    return valid;
  });
}
