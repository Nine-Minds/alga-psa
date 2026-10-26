// Shared helpers for guides 02/01/10/11 of round 7e137086e6. Read-only SQL receipts only.
const fs = require('fs');
const H = require('/home/robert/alga-copies/feature-co-managed-it/docs/evidence/co-managed-deploy/7e137086e6/guides/scripts/runtime.cjs');
const OZ = 'fa7f912f-6b62-463e-85cc-ffedab47ac44';
const WR = { clientId: 'e1d953b4-4f14-41fe-8f2c-828dd85a15b8', customer: 'c64b2666-7dd6-4c61-8ced-4b233f628e61', relationship: '2be5cb32-91e8-491a-9ec4-16ab019c7d40', operationId: '1a832203-2725-4b90-8d4b-90207ebfc23f' };
const json = (q) => { const v = H.sql(q); return v ? JSON.parse(v) : null; };
const pool = () => json(`select row_to_json(x) from (select e.capacity, e.source, e.source_reference, e.revision,
  (select coalesce(sum(seats),0) from co_managed_allocations a where a.tenant=e.tenant and a.state<>'released')::int as allocated
  from co_managed_entitlements e where e.tenant='${OZ}') x`);
const allocations = () => json(`select coalesce(json_agg(x order by x.created_at),'[]') from (select allocation_id, customer_tenant, seats, state, released_at, created_at from co_managed_allocations where tenant='${OZ}') x`);
const purchases = () => json(`select coalesce(json_agg(x order by x.created_at),'[]') from (select operation_id, quantity, state, provider_reference, created_at from co_managed_purchase_operations where tenant='${OZ}') x`);
const qa = () => ({ name: 'qa', email: 'qa@emeraldcity.oz', password: H.credential('continuation-test-login.json').password });
const sink = async () => (await (await fetch('http://127.0.0.1:9177/control/smtp-sink/state/emails')).json()).result;
const stripe = async (view) => (await (await fetch('http://127.0.0.1:9175/control/stripe/state/' + view)).json()).result;
const actionId = (name) => {
  const m = JSON.parse(fs.readFileSync(`${H.worktree}/server/${H.build.dist}/server/server-reference-manifest.json`, 'utf8'));
  return Object.entries(m.node).filter(([, x]) => x.exportedName === name).map(([id]) => id);
};
const statValue = async (page, label) => page.evaluate((label) => {
  const el = [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent.trim() === label);
  return el ? Number(el.previousElementSibling?.textContent.trim()) : null;
}, label);
const receipt = (dir, name, data) => fs.writeFileSync(`${dir}/${name}.json`, JSON.stringify(data, null, 2));
module.exports = { ...H, H, OZ, WR, json, pool, allocations, purchases, qa, sink, stripe, actionId, statValue, receipt };
// QA is limited to 5 concurrent sessions (oldest revoked first) and other agents sign in as QA several times a
// minute, so a QA session here survives ~40-70 s. fresh(route) signs in again through the real form when the
// current QA session is older than maxAge (or was revoked), then navigates.
function qaSession({ page, actor, go, mark }, maxAge = 20000) {
  let last = 0;
  const login = async (why) => { if (why) await mark('qa-session-refresh', { why }); await actor(qa()); last = Date.now(); };
  return {
    async fresh(route, why = 'session age') {
      if (Date.now() - last > maxAge) await login(last ? why : null);
      if (route) { await go(route); if (/\/auth\//.test(page.url())) { await login('revoked by max_sessions'); await go(route); } }
    },
    touch() { last = Date.now(); },
    invalidate() { last = 0; },
    async reload() { const u = new URL(page.url()); await this.fresh(u.pathname + u.search, 'reload'); },
  };
}
module.exports.qaSession = qaSession;
