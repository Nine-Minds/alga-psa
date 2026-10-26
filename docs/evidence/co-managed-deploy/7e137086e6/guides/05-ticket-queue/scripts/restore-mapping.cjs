// Recovery after failed attempt a1: return White Rabbit's Critical priority mapping to Not mapped through the MSP client view.
const { scenario } = require('../../scripts/runtime.cjs');
const L = require('../../03-access-policies/scripts/lib.cjs');
(async () => {
  await scenario(require('path').resolve(__dirname, '..'), 'attempts/restore-mapping-' + Date.now(), async ({ page, actor, mark, check, shot }) => {
    const h = L.helpers(page, { mark, check, shot });
    await actor(L.qa);
    for (const p of Object.values(L.PRIORITY)) if (h.mappingRow(p)) { await h.setSlaMapping(p, 'Not mapped'); await L.until(() => !h.mappingRow(p), 'unmapped', 30000); }
    const policyId = L.sql(`select sla_policy_id from sla_policies where tenant='${L.ids.msp}' and policy_name='CM-REVIEW-20261026-08 final-b MSP policy'`);
    if (h.clientPolicy() === policyId) { await h.toggleClientSlaPolicy(policyId); await L.until(() => h.clientPolicy() === '', 'client policy unassigned', 60000); }
    await check('escalation-prerequisites-restored', Object.values(L.PRIORITY).every((p) => !h.mappingRow(p)) && h.clientPolicy() === '');
  });
})();
