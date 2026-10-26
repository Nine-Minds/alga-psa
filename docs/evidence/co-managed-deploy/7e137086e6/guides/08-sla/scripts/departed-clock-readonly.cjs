// Guide 08 §5 supplement (read-only): guide 10's disposable relationship (Accept-7, terminated
// 2026-10-26T03:55Z) had MSP obligations. Check the departed customer keeps its own ticket view without
// the former MSP's live clock, and the former MSP can no longer open the shared ticket.
const L = require('../../06-projects-and-tasks/scripts/lib.cjs'), path = require('path');
const T = '0a3c039e-c4c7-4108-8301-bfe5232a829a', REL = 'e24c064b-1b13-471d-8f24-3441f26d9b0e', TICKET = '8120f19f-dc24-4c9d-9585-1e510ca5a245', TITLE = 'CM-REVIEW-20261026-10 703235 shared ticket';
(async () => { const r = await L.scenario(path.dirname(__dirname), 'supplement-departed-clock-readonly', async ({ page, actor, go, check, shot, chapter, mark }) => {
  const c = L.credential('cm-review-20261026-01-accept-7-admin.json');
  await mark('obligation-before', L.json(`select obligation_id, clock->'pauseReasons' as pause, clock->'response'->>'completedAt' as response_completed from sla_organization_obligations where source_tenant='${T}' and ticket_id='${TICKET}'`));
  await chapter('5. Departed customer keeps its own ticket; no live former-MSP clock');
  await actor({ name: 'departed-customer-admin', email: c.email, password: c.password });
  await go('/msp/tickets/' + TICKET); await page.getByText(TITLE).filter({ visible: true }).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(2500);
  const body = await page.locator('body').innerText();
  await check('departed-customer-retains-native-ticket', body.includes(TITLE));
  await check('departed-customer-has-no-live-oz-sla-display', !/OZ SLA/i.test(body) && await page.locator('#co-ticket-sla').count() === 0, { coManagedSectionPresent: await page.locator('#co-ticket-sla').count() });
  await shot('departed-customer-ticket');
  await chapter('5. Former MSP cannot open the departed shared ticket or its clock');
  await actor(L.qa()); await go(`/msp/co-management/tickets/${T}/${REL}/${TICKET}`); await page.waitForTimeout(3500);
  const q = await page.locator('body').innerText();
  await check('former-msp-cannot-read-departed-ticket-or-clock', !q.includes(TITLE) && await page.locator('#co-ticket-sla').count() === 0);
  await shot('former-msp-denied');
  return { status: 'passed', limitations: ['Read-only supplement on guide 10\'s disposable relationship; no data changed.'] }; });
  if (r.scenarioStatus === 'failed') process.exitCode = 1; })();
