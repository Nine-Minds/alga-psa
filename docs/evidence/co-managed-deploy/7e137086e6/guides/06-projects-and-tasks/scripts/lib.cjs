// Shared helpers for guides 06/07/08 (round 7e137086e6). Credentials are read from the private
// card directory at runtime; nothing secret is written to evidence.
const rt = require('../../scripts/runtime.cjs');
const { credential, sql, until, origin, fixtures } = rt;
const fs = require('fs');
const fx = fixtures();
const ids = {
  oz: fx.oz, qaId: fx.qaId, customer: fx.active.customer, relationship: fx.active.relationship,
  client: fx.active.clientId, operation: fx.active.operationId, kansas: fx.departing,
};
const qa = () => ({ name: 'qa', email: 'qa@emeraldcity.oz', password: credential('continuation-test-login.json').password });
const alice = () => ({ name: 'alice', email: 'alice@whiterabbit.test', password: credential('reprovision-20261025-active-admin.json').password });
const kansas = () => ({ name: 'kansas-admin', email: 'admin@kansasfarms.test', password: credential('reprovision-20261025-departing-admin.json').password });
const json = (q) => JSON.parse(sql(`select coalesce(json_agg(x),'[]') from (${q}) x`));
const esc = (s) => String(s).replace(/'/g, "''");
// Form login in a separate (secondary) browser context — same real sign-in form as runtime.actor().
async function formLogin(context, who, portal) {
  const page = await context.newPage();
  const url = portal ? `${origin}/auth/client-portal/signin?tenant=${portal}` : `${origin}/auth/msp/signin`;
  const pfx = portal ? 'client' : 'msp';
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction((id) => { const b = document.querySelector(id); return b && Object.keys(b).some((k) => k.startsWith('__react')); }, `#${pfx}-sign-in-button`, { timeout: 90000 });
    await page.locator(`#${pfx}-email-field`).fill(who.email); await page.waitForTimeout(800);
    await page.locator(`#${pfx}-password-field`).fill(who.password); await page.locator(`#${pfx}-sign-in-button`).click();
    const ok = await until(async () => { const s = await context.request.get(origin + '/api/auth/session').then((r) => r.json()); return s.user?.email === who.email ? s : null; }, 'login ' + who.name, 30000).catch(() => null);
    if (ok) return page;
  }
  throw Error('secondary login failed for ' + who.name);
}
const portalSlug = (tenant) => { const h = tenant.replaceAll('-', ''); return h.slice(0, 6) + h.slice(-6); };
module.exports = { ...rt, ids, qa, alice, kansas, json, esc, formLogin, portalSlug, fs };
