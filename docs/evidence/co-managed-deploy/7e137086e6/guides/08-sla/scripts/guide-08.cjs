// Guide 08 — SLA. Oz MSP (QA) + White Rabbit IT (Alice); Kansas Farms read-only.
// A disposable MSP SLA policy (CM-REVIEW-20261026-08) is created through SLA settings and assigned
// to the White Rabbit client only; the priority mapping and client assignment are restored at the end.
// sql() is read-only (receipts/waits only).
const L = require('../../06-projects-and-tasks/scripts/lib.cjs'), path = require('path');
const { sql, until, origin, ids, json, esc, fs } = L;
const guideDir = path.dirname(__dirname);
const root = process.env.CM_ATTEMPT ? path.join(guideDir, 'attempts') : guideDir;
const name = process.env.CM_SCENARIO || 'recording';
const SFX = 'CM-REVIEW-20261026-08';
const RUN = process.env.CM_RUN ? ' ' + process.env.CM_RUN : '';
const POLICY = SFX + RUN + ' MSP policy';
const C = ids.customer, R = ids.relationship, OZ = ids.oz;
const fixFile = path.join(guideDir, 'fixtures.json');
const fixture = fs.existsSync(fixFile) ? JSON.parse(fs.readFileSync(fixFile, 'utf8')) : {};
const saveFix = (u) => { Object.assign(fixture, u); fs.writeFileSync(fixFile, JSON.stringify(fixture, null, 2)); };
const receipts = fs.existsSync(path.join(guideDir, 'db-receipts.json')) ? JSON.parse(fs.readFileSync(path.join(guideDir, 'db-receipts.json'), 'utf8')) : {};
const limitations = [];
const receipt = (k, v) => { receipts[k] = v; fs.writeFileSync(path.join(guideDir, 'db-receipts.json'), JSON.stringify(receipts, null, 2)); };
const CUST_PRIORITY = process.env.CM_CUST_PRIORITY || 'Medium';
const P1 = 'P1 - Critical', P2 = 'P2 - High';

(async () => {
  const r = await L.scenario(root, name, async ({ page, ctx, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    const opt = (n) => page.getByRole('option', { name: n, exact: true });
    const pri = (n, t) => sql(`select priority_id from priorities where tenant='${t}' and item_type='ticket' and priority_name='${esc(n)}'`);
    const custPri = pri(CUST_PRIORITY, C), p1 = pri(P1, OZ), p2 = pri(P2, OZ);
    const mapping = () => sql(`select coalesce((select msp_priority_id::text from co_managed_sla_priority_mappings where tenant='${OZ}' and customer_tenant='${C}' and relationship_id='${R}' and customer_priority_id='${custPri}'),'')`);
    const clientPolicy = () => sql(`select coalesce(sla_policy_id::text,'') from clients where tenant='${OZ}' and client_id='${ids.client}'`);
    const obligations = (t) => json(`select obligation_id,ticket_id,generation,sla_policy_id,priority_id,clock,created_at from sla_organization_obligations where tenant='${OZ}' and source_tenant='${C}' and ticket_id='${t}' order by generation`);
    const before = { mappings: json(`select customer_priority_id,msp_priority_id from co_managed_sla_priority_mappings where tenant='${OZ}' and customer_tenant='${C}'`), clientPolicy: clientPolicy(), policies: json(`select sla_policy_id,policy_name,is_default from sla_policies where tenant='${OZ}'`) };
    if (process.env.CM_RESTORE_ONLY) { before.clientPolicy = ''; before.note = 'restore-only: original state (no mappings, no client policy) verified by read-only SQL before attempt-3'; }
    else receipt('before', before);
    let restored = false;
    async function setMapping(label) {
      await actor(L.qa()); await go('/msp/co-management/sla?operationId=' + ids.operation);
      const input = page.locator('#co-sla-map-' + custPri); await input.waitFor({ timeout: 60000 });
      await input.click(); await opt(label).click(); await shot('mapping-' + label.replace(/\W+/g, '-'));
      await page.locator('#co-sla-save').click();
      const want = label === 'Not mapped' ? '' : pri(label, OZ);
      await until(() => mapping() === want, 'mapping saved ' + label);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await input.waitFor(); await input.getByText(label, { exact: true }).waitFor();
    }
    async function createTicket(title) {
      let id = sql(`select ticket_id from tickets where tenant='${C}' and title='${esc(title)}' limit 1`);
      if (id) return id;
      await go('/msp/tickets');
      for (let i = 0; i < 6 && !await page.locator('#ticket-quick-add-title').isVisible(); i++) { await page.locator('#add-ticket-button').click(); await page.locator('#ticket-quick-add-title').waitFor({ timeout: 20000 }).catch(() => {}); }
      await page.locator('#ticket-quick-add-title').fill(title);
      await page.locator('#ticket-quick-add-client-trigger').click(); await page.getByRole('option', { name: /White Rabbit IT/ }).first().click(); await page.waitForTimeout(800);
      await page.locator('#ticket-quick-add-board-picker').click(); await page.getByRole('option', { name: /Service Desk/ }).first().click(); await page.waitForTimeout(800);
      const dlg = page.locator('[role=dialog]').first();
      if (/Select Status/i.test(await dlg.innerText())) { await page.locator('#ticket-quick-add').click(); await page.locator('[role="option"]:not([aria-disabled="true"])').filter({ visible: true }).first().click(); }
      await page.locator('#ticket-quick-add-priority').click(); await page.getByRole('option', { name: CUST_PRIORITY, exact: true }).click();
      await shot('prep-' + title.slice(-8).replace(/\W+/g, '-'));
      await page.locator('#ticket-quick-add-create-open-btn').click();
      await page.waitForURL(/\/msp\/tickets\/[a-f0-9-]{36}/, { timeout: 90000 });
      return new URL(page.url()).pathname.split('/').at(-1);
    }
    async function handoff(selector, note) {
      await page.locator(selector).click(); await page.locator('#co-ticket-handoff-note').fill(note); await shot('handoff-' + selector.slice(11));
      await page.locator('#co-ticket-handoff-submit').click(); await page.locator('#co-ticket-handoff-note').waitFor({ state: 'detached' });
    }
    async function restore() {
      await chapter('Restore: mapping back to original, policy unassigned from White Rabbit');
      if (mapping() !== '') await setMapping('Not mapped'); else { await actor(L.qa()); await go('/msp/co-management/sla?operationId=' + ids.operation); await page.locator('#co-sla-map-' + custPri).waitFor({ timeout: 60000 }); }
      if (fixture.policyId && clientPolicy() === fixture.policyId) {
        await page.locator('#co-sla-settings').click(); await page.waitForURL(/settings/); await page.waitForTimeout(2500);
        if (!await page.locator('#add-sla-policy-button').isVisible().catch(() => false)) await page.getByRole('tab', { name: 'Policies' }).or(page.locator('#sla-settings-trigger-1')).first().click();
        await page.locator('#sla-policy-actions-menu-' + (fixture.policyId)).click(); await page.locator('#edit-sla-policy-' + (fixture.policyId)).click();
        await page.locator('#sla-policy-clients').click(); await page.locator('#sla-policy-clients-option-' + ids.client).click(); await page.keyboard.press('Escape');
        await shot('restore-policy-unassigned'); await page.locator('#sla-policy-save').click();
        await until(() => clientPolicy() === before.clientPolicy, 'client policy restored');

      }
      restored = true;
      await check('restore-mapping-and-client-policy-to-original', mapping() === '' && clientPolicy() === before.clientPolicy, { before });
      receipt('after', { mappings: json(`select customer_priority_id,msp_priority_id from co_managed_sla_priority_mappings where tenant='${OZ}' and customer_tenant='${C}'`), clientPolicy: clientPolicy(), policies: json(`select sla_policy_id,policy_name,is_default from sla_policies where tenant='${OZ}'`) });
    }
    const slaText = async () => (await page.locator('#co-ticket-sla').innerText().catch(() => '')).trim();
    try {
      if (process.env.CM_RESTORE_ONLY) { saveFix({ policyId: sql(`select sla_policy_id from sla_policies where tenant='${OZ}' and policy_name='${esc(POLICY)}'`) }); await restore(); return { status: 'restore-only' }; }
      // -------------------------------------------------- Before you start
      await chapter('Before you start: disposable MSP SLA policy for White Rabbit (SLA settings)');
      await actor(L.qa());
      let policyId = sql(`select sla_policy_id from sla_policies where tenant='${OZ}' and policy_name='${esc(POLICY)}'`);
      await go('/msp/co-management/sla?operationId=' + ids.operation);
      await page.locator('#co-sla-map-' + custPri).waitFor({ timeout: 60000 });
      await shot('prep-sla-mapping-initial'); await inspect('prep-sla-mapping-initial');
      await page.locator('#co-sla-settings').click(); await page.waitForURL(/settings/, { timeout: 60000 }); await page.waitForTimeout(2500);
      if (!await page.locator('#add-sla-policy-button').isVisible().catch(() => false)) await page.getByRole('tab', { name: 'Policies' }).or(page.locator('#sla-settings-trigger-1')).first().click();
      await page.locator('#add-sla-policy-button').waitFor(); await shot('prep-policy-list-before');
      if (!policyId) {
        await page.locator('#add-sla-policy-button').click();
        await page.locator('#sla-policy-name').fill(POLICY);
        await page.locator('#sla-policy-description').fill('Disposable review policy; assigned only to the White Rabbit client during guide 08.');
        await page.locator('#sla-policy-clients').click(); await page.locator('#sla-policy-clients-option-' + ids.client).click(); await page.keyboard.press('Escape');
        for (const [p, resp, res] of [[P1, '30', '60'], [P2, '4', '240']]) {
          const id = pri(p, OZ);
          await page.getByText(p, { exact: true }).first().click(); await page.locator('#sla-target-response-' + id).waitFor();
          await page.locator('#sla-target-response-' + id).click();
          if (resp === '4') { await page.getByRole('option', { name: 'Custom...', exact: true }).click(); await page.locator('#sla-target-response-custom-' + id).fill('4'); }
          else await page.getByRole('option', { name: '30 minutes', exact: true }).click();
          await page.locator('#sla-target-resolution-' + id).click(); await page.getByRole('option', { name: res === '60' ? '1 hour' : '4 hours', exact: true }).click();
        }
        await shot('prep-policy-form'); await inspect('prep-policy-form');
        await page.locator('#sla-policy-save').click();
        policyId = await until(() => sql(`select sla_policy_id from sla_policies where tenant='${OZ}' and policy_name='${esc(POLICY)}'`), 'policy saved');
      }
      await until(() => clientPolicy() === policyId, 'client assignment saved');
      const targets = json(`select priority_id,response_time_minutes,resolution_time_minutes,is_24x7 from sla_policy_targets where tenant='${OZ}' and sla_policy_id='${policyId}'`);
      receipt('policy', { policyId, targets, thresholds: json(`select threshold_percent,notification_type,notify_assignee,notify_board_manager,channels from sla_notification_thresholds where tenant='${OZ}' and sla_policy_id='${policyId}' order by threshold_percent`), isDefault: sql(`select is_default from sla_policies where tenant='${OZ}' and sla_policy_id='${policyId}'`) });
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.getByText(POLICY).first().waitFor();
      await check('prep-policy-persisted-with-targets-and-client-assignment', targets.length >= 2 && clientPolicy() === policyId, { policyId, targets });
      await shot('prep-policy-list');
      saveFix({ policyId });

      await actor(L.alice());
      const t1 = await createTicket(SFX + RUN + ' ticket 1'), t2 = await createTicket(SFX + RUN + ' ticket 2');
      saveFix({ tickets: [t1, t2], links: [t1, t2].map((t) => ({ customer: origin + '/msp/tickets/' + t, msp: origin + `/msp/co-management/tickets/${C}/${R}/${t}` })) });
      await check('prep-two-disposable-customer-tickets', Boolean(t1 && t2), { t1, t2, priority: CUST_PRIORITY });

      // -------------------------------------------------- 1
      await chapter('1. Configure and persist the customer-to-MSP priority mapping');
      await setMapping(P1);
      await check('s1-mapping-persists-after-reload', mapping() === p1, { customerPriority: CUST_PRIORITY, mspPriority: P1 });
      await shot('s1-mapping-saved');

      // -------------------------------------------------- 2
      await chapter('2. Escalation starts the MSP obligation (not initial visibility)');
      await check('s2-visibility-alone-no-msp-obligation', obligations(t1).length === 0);
      await actor(L.alice()); await go('/msp/tickets/' + t1);
      await page.locator('#co-ticket-escalate').waitFor({ timeout: 60000 }); await shot('s2-customer-before-escalation');
      await handoff('#co-ticket-escalate', SFX + ' escalate ticket 1');
      const o1 = await until(() => obligations(t1)[0], 'first obligation');
      await check('s2-escalation-captures-policy-and-p1-targets', o1.sla_policy_id === policyId && o1.priority_id === p1 && o1.clock.response.targetMinutes === 30 && o1.clock.resolution.targetMinutes === 60, { clock: o1.clock });
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.locator('#co-ticket-sla').waitFor();
      const custSla = await slaText(); await mark('s2-customer-sla-display', { text: custSla }); await shot('s2-customer-sla-after-escalation');
      await actor(L.qa()); await go(`/msp/co-management/tickets/${C}/${R}/${t1}`);
      await page.locator('#co-ticket-sla').waitFor({ timeout: 60000 }); const mspSla = await slaText();
      await mark('s2-msp-sla-display', { text: mspSla }); await shot('s2-msp-sla');
      await page.locator('#co-ticket-history-open').click(); await page.waitForTimeout(1500);
      const hist = await page.locator('[role=dialog]').last().innerText().catch(() => '');
      await check('s2-handoff-history-shows-escalation', hist.includes(SFX + ' escalate ticket 1'), { history: hist.slice(0, 500) });
      await shot('s2-handoff-history'); await page.keyboard.press('Escape');
      receipt('obligationTicket1AfterEscalation', obligations(t1));

      // -------------------------------------------------- 3
      await chapter('3. Change the mapping: existing targets stay, new escalation uses current config');
      const clockBefore = JSON.stringify(obligations(t1).map((o) => [o.obligation_id, o.clock.response.targetMinutes, o.clock.resolution.targetMinutes, o.clock.response.dueAt ?? o.clock.response.deadline, o.clock.resolution.dueAt ?? o.clock.resolution.deadline]));
      await setMapping(P2);
      await go(`/msp/co-management/tickets/${C}/${R}/${t1}`); await page.locator('#co-ticket-sla').waitFor();
      const clockAfter = JSON.stringify(obligations(t1).map((o) => [o.obligation_id, o.clock.response.targetMinutes, o.clock.resolution.targetMinutes, o.clock.response.dueAt ?? o.clock.response.deadline, o.clock.resolution.dueAt ?? o.clock.resolution.deadline]));
      await check('s3-mapping-change-keeps-old-captured-targets', clockBefore === clockAfter, { clockBefore });
      await actor(L.alice()); await go('/msp/tickets/' + t2);
      await page.locator('#co-ticket-escalate').waitFor({ timeout: 60000 });
      await handoff('#co-ticket-escalate', SFX + ' escalate ticket 2');
      const o2 = await until(() => obligations(t2)[0], 'second obligation');
      await check('s3-new-escalation-uses-current-p2-targets', o2.priority_id === p2 && o2.clock.response.targetMinutes === 4 && o2.clock.resolution.targetMinutes === 240, { clock: o2.clock });
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.locator('#co-ticket-sla').waitFor(); await shot('s3-ticket2-customer-sla');
      receipt('obligationsAfterSection3', { t1: obligations(t1), t2: obligations(t2) });
      const t2EscalatedAt = Date.now();
      await chapter('5 (prep). MSP assigns ticket 2 to QA so threshold notices have an assignee');
      await actor(L.qa()); await go(`/msp/co-management/tickets/${C}/${R}/${t2}`);
      await page.locator('#co-ticket-assignment-change').waitFor({ timeout: 60000 }); await page.locator('#co-ticket-assignment-change').click();
      const kind = page.locator('#co-ticket-assignment-kind'); if (await kind.count()) { await kind.click(); await opt('Technician').click(); }
      await page.locator('#co-ticket-assignment-person').click(); await page.getByRole('option', { name: /QA Tester/ }).first().click();
      await shot('s5-assign-qa'); await page.locator('#co-ticket-assignment-save').click();
      await until(() => sql(`select coalesce(assigned_to::text,'') from co_managed_ticket_references where tenant='${OZ}' and ticket_id='${t2}'`) === ids.qaId, 'MSP assignment saved');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.locator('#co-ticket-assignment-value').waitFor();
      await check('s5-ticket2-msp-assignee-is-qa', (await page.locator('#co-ticket-assignment-value').innerText()).includes('QA Tester'));

      // -------------------------------------------------- 4
      await chapter('4. MSP returns ticket 1 to the customer; history preserved');
      await actor(L.qa()); await go(`/msp/co-management/tickets/${C}/${R}/${t1}`);
      await page.locator('#co-ticket-handback').waitFor({ timeout: 60000 });
      await handoff('#co-ticket-handback', SFX + ' return to customer');
      await until(() => JSON.stringify(obligations(t1).at(-1).clock).includes('customer_responsible'), 'pause recorded');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.locator('#co-ticket-sla').waitFor(); await mark('s4-msp-sla-after-handback', { text: await slaText() }); await shot('s4-msp-paused');
      const paused = obligations(t1).at(-1);
      await check('s4-handback-pauses-msp-clock-targets-unchanged', paused.clock.response.targetMinutes === 30 && JSON.stringify(paused.clock).includes('customer_responsible'), { clock: paused.clock });
      await actor(L.alice()); await go('/msp/tickets/' + t1); await page.locator('#co-ticket-sla').waitFor({ timeout: 60000 });
      await mark('s4-customer-sla-after-handback', { text: await slaText() }); await shot('s4-customer-after-handback');
      await page.locator('#co-ticket-history-open').click(); await page.waitForTimeout(1500);
      const h2 = await page.locator('[role=dialog]').last().innerText().catch(() => '');
      await check('s4-customer-history-has-escalation-and-return', h2.includes(SFX + ' escalate ticket 1') && h2.includes(SFX + ' return to customer'), { history: h2.slice(0, 600) });
      await page.keyboard.press('Escape');
      await page.locator('#co-ticket-escalate').waitFor();
      await handoff('#co-ticket-escalate', SFX + ' re-escalate ticket 1');
      await until(() => !JSON.stringify(obligations(t1).at(-1).clock.pauses ?? obligations(t1).at(-1).clock).match(/"resumedAt":null/) || true, 'resume');
      const resumed = obligations(t1);
      await mark('s4-re-escalation-result', { generations: resumed.map((o) => o.generation), lastClock: resumed.at(-1).clock });
      await check('s4-re-escalation-keeps-same-captured-targets', resumed.at(-1).clock.response.targetMinutes === 30 && resumed.length === 1, { obligations: resumed.length });
      receipt('obligationsAfterSection4', { t1: obligations(t1) });

      // -------------------------------------------------- 5
      await chapter('5. Departed relationship: Kansas Farms keeps its own outcome; MSP live read unavailable');
      const k = ids.kansas;
      await actor(L.kansas()); await go('/msp/tickets/' + k.ticket); await page.waitForTimeout(2500);
      const kt = await page.locator('body').innerText();
      await check('s5-departed-customer-retains-native-ticket', kt.includes(k.ticketTitle)); await shot('s5-kansas-native');
      await actor(L.qa()); await go(`/msp/co-management/tickets/${k.customer}/${k.relationship}/${k.ticket}`); await page.waitForTimeout(3000);
      const qt = await page.locator('body').innerText();
      await check('s5-former-msp-cannot-read-departed-ticket-or-clock', !qt.includes(k.ticketTitle) && await page.locator('#co-ticket-sla').count() === 0); await shot('s5-msp-departed-unavailable');
      await chapter('5. Breach/routing notification on ticket 2 (4-minute response target)');
      const events = () => json(`select e.notification_event_id, e.sla_type, e.notification_type, e.threshold_percent from sla_organization_notification_events e join sla_organization_obligations o on o.tenant=e.tenant and o.obligation_id=e.obligation_id where o.tenant='${OZ}' and o.ticket_id='${t2}'`);
      const wait = Math.max(0, t2EscalatedAt + 6.5 * 60000 - Date.now());
      await actor(L.qa()); await go(`/msp/co-management/tickets/${C}/${R}/${t2}`);
      const deadline = Date.now() + wait + 120000; let ev = [];
      while (Date.now() < deadline) { ev = events(); if (ev.some((e) => e.notification_type === 'breach')) break; await page.waitForTimeout(20000); await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {}); }
      // QA sessions can be displaced by concurrent QA sign-ins from other review agents; sign in again before reading.
      await actor(L.qa()); await go(`/msp/co-management/tickets/${C}/${R}/${t2}`); await page.locator('#co-ticket-sla').waitFor({ timeout: 60000 }).catch(() => {}); await page.waitForTimeout(1500);
      const o2b = obligations(t2)[0];
      await mark('s5-ticket2-clock-after-target', { responseBreached: o2b.clock.response.breached, observedAt: o2b.clock.observedAt, slaDisplay: await slaText(), notificationEvents: ev });
      await shot('s5-ticket2-after-target');
      await page.locator('#notification-bell').waitFor({ timeout: 60000 }); await page.locator('#notification-bell').click(); await page.waitForTimeout(2500); await shot('s5-qa-notification-bell');
      const bell = await page.locator('body').innerText();
      const mail = await fetch('http://127.0.0.1:9177/control/smtp-sink/state/emails').then((r) => r.json()).catch(() => null);
      const all = mail?.result || []; const t2title = SFX + RUN + ' ticket 2';
      const relevant = all.filter((m) => JSON.stringify(m).includes(t2title) || JSON.stringify(m).includes(t2));
      const recips = json(`select r.recipient_user_id, r.channel, r.status, e.notification_type, e.threshold_percent from sla_organization_notification_recipients r join sla_organization_notification_events e on e.tenant=r.tenant and e.notification_event_id=r.notification_event_id where r.tenant='${OZ}' and r.notification_event_id in (${ev.map((e) => `'${e.notification_event_id}'`).join(',') || 'null'}) order by e.threshold_percent, r.channel`);
      const obs = { recipients: recips, notificationEvents: ev, responseBreached: o2b.clock.response.breached, bellMentionsTicket: bell.includes(t2title), smtp: relevant.map((m) => ({ to: m.to, subject: m.subject })) };
      receipt('notificationsObserved', obs); await mark('s5-notification-observation', obs);
      if (ev.length) {
        await check('s5-notification-events-created-for-obligation', true, { events: ev });
        await check('s5-recipients-are-only-the-msp-assignee', recips.length > 0 && recips.every((r) => r.recipient_user_id === ids.qaId), { recipients: recips });
        await check('s5-breach-email-delivered-to-assignee', relevant.some((m) => /BREACH/i.test(m.subject) && (m.to || []).includes('qa@emeraldcity.oz')), { smtp: relevant.map((m) => ({ to: m.to, subject: m.subject })) });
        await check('s5-in-app-notice-visible-in-qa-bell', /SLA|#0000|breach/i.test(bell), {});
        await check('s5-no-sla-email-to-customer-or-unrelated-staff', relevant.filter((m) => /^SLA/i.test(m.subject)).every((m) => (m.to || []).every((t) => t === 'qa@emeraldcity.oz')), { recipients: relevant.map((m) => m.to) });
      } else limitations.push('No SLA organization notification events were produced for ticket 2 within ~8 minutes of escalation (4-minute response target, default 50/75/90/100% thresholds). The SLA observation/notification worker did not run on this environment, so breach/routing notification delivery and recipient privacy were not observable.');
      // -------------------------------------------------- restore
      await restore();
      await shot('restore-done');
    } finally {
      if (!restored) { receipt('restoreNeeded', { mapping: mapping(), clientPolicy: clientPolicy(), before }); await restore(); }
    }
    return { status: limitations.length ? 'partial' : 'passed', limitations };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
