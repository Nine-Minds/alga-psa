// Guide 12 — Customer-owned integrations (round 7e137086e6, served build 54e75edfab).
// Real UI only; sql() is read-only. The Microsoft app registration uses the operator-prepared Graph
// *simulator* client (provider-state.json, private dir); its secret is never written to evidence.
// Disposable records carry CM-REVIEW-20261026-12.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { scenario, sql, until, origin } = require('../../scripts/runtime.cjs');
const { actors, A, OZ, WR } = require('../../09-time-and-billing/scripts/common.cjs');
const RUN = process.env.CM_RUN || '';
const SFX = 'CM-REVIEW-20261026-12' + (RUN ? '-' + RUN : '');
const APP = SFX + ' simulator app';
const REQ_NAME = SFX + ' Requester', REQ_EMAIL = `cm-review-20261026-12${RUN ? '-' + RUN : ''}.requester@whiterabbit.test`;
const TICKET = SFX + ' requester mail ticket';
const MSG = { requester: SFX + ' requester-audience update', shared: SFX + ' shared-IT-only note', priv: SFX + ' private customer note' };
const sim = JSON.parse(fs.readFileSync('/home/robert/card-review-private/co-managed-it-3363/provider-state.json', 'utf8')).emulators.msgraph;
const SIM = { clientId: sim.clients[0].clientId, secret: sim.clients[0].secret, directory: sim.organizations[0].id };
const guideDir = path.dirname(__dirname);
const json = (q) => JSON.parse(sql(`select coalesce(json_agg(x),'[]') from (${q}) x`));
const esc = (s) => String(s).replace(/'/g, "''");
const receipts = {};
const receipt = (k, v) => { receipts[k] = v; fs.writeFileSync(path.join(guideDir, 'db-receipts' + (RUN ? '-' + RUN : '') + '.json'), JSON.stringify(receipts, null, 2)); };
const sink = async () => (await (await fetch('http://127.0.0.1:9177/control/smtp-sink/state/emails')).json()).result || [];
const body = (m) => String(m.text || '') + String(m.html || '');
const to = (m) => (Array.isArray(m.to) ? m.to : [m.to]).map(String);

(async () => {
  const r = await scenario(guideDir, process.env.CM_SCENARIO || 'recording', async ({ page, ctx, actor, go, mark, check, shot, inspect, chapter }) => {
    const profiles = (tenant) => json(`select profile_id,display_name,client_id,tenant_id,is_default,is_archived from microsoft_profiles where tenant='${tenant}' and display_name like 'CM-REVIEW-20261026-12%'`);
    receipt('profilesBefore', { customer: profiles(WR), sponsor: profiles(OZ) });

    // ------------------------------------------------------------- 1
    await chapter('1. Customer saves a customer-owned Microsoft app registration (Graph simulator binding)');
    await actor(actors.alice());
    const session = await ctx.request.get(origin + '/api/auth/session').then((x) => x.json());
    await check('s1-session-is-customer-workspace-not-sponsor', session.user?.tenant === WR && session.user.tenant !== OZ, { tenant: session.user?.tenant, product: session.user?.product_code });
    await go('/msp/settings/email');
    await check('s1-outbound-provider-is-nine-minds-managed', (await page.locator('main').innerText()).includes('Nine Minds Managed'));
    await page.getByRole('tab', { name: /Inbound/ }).click(); await page.locator('#open-microsoft-providers-settings-button').waitFor();
    await shot('s1-01-email-inbound');
    await page.locator('#open-microsoft-providers-settings-button').click();
    await page.waitForURL(/\/msp\/co-management\/providers/, { timeout: 60000 });
    await check('s1-open-providers-reaches-customer-provider-workbench', true, { url: page.url() });
    await page.locator('#provider-credentials-google-tab').waitFor(); await page.locator('#google-settings-save').waitFor({ timeout: 60000 }); await page.waitForTimeout(1000);
    const google = await inspect('s1-02-google-form');
    await check('s1-google-form-offers-provider-specific-fields', ['google-project-id', 'google-gmail-client-id', 'google-gmail-client-secret', 'google-settings-save'].every((id) => google.inputs.some((x) => x.id === id)));
    await shot('s1-02-google-form');
    await page.locator('#provider-credentials-microsoft-tab').click(); await page.locator('#microsoft-settings-add-profile').waitFor();
    await shot('s1-03-microsoft-before');
    if (!profiles(WR).some((p) => p.display_name === APP)) {
      await page.locator('#microsoft-settings-add-profile').click(); await page.locator('#microsoft-profile-display-name').waitFor();
      await page.locator('#microsoft-profile-display-name').fill(APP);
      await page.locator('#microsoft-profile-client-id').fill(SIM.clientId);
      await page.locator('#microsoft-profile-tenant-id').fill(SIM.directory);
      await shot('s1-04-form-before-secret');
      await page.locator('#microsoft-profile-client-secret').fill(SIM.secret);
      for (const cap of ['msp_sso', 'email']) { const c = page.locator('#microsoft-profile-capability-' + cap); if (!(await c.isChecked().catch(() => false))) await c.click(); }
      await page.locator('#microsoft-profile-save').click();
      await until(() => profiles(WR).some((p) => p.display_name === APP), 'profile persisted', 30000);
    }
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.locator('#provider-credentials-microsoft-tab').click(); await page.getByText(APP).first().waitFor({ timeout: 30000 });
    const prof = profiles(WR).find((p) => p.display_name === APP);
    const html = await page.content();
    const card = await page.locator('main').innerText();
    await check('s1-binding-persisted-in-customer-tenant-only', prof && prof.client_id === SIM.clientId && profiles(OZ).length === 0, { profile: prof, sponsorProfiles: profiles(OZ).length });
    await check('s1-secret-redacted-after-reload', !html.includes(SIM.secret) && !card.includes(SIM.secret), { secretSha256Prefix: crypto.createHash('sha256').update(SIM.secret).digest('hex').slice(0, 12) });
    await shot('s1-05-microsoft-after-reload'); await inspect('s1-05-microsoft-after-reload');
    await page.locator('#co-managed-providers-back-to-email').click(); await page.waitForURL(/\/msp\/settings\/email/, { timeout: 60000 });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    await check('s1-back-link-returns-to-customer-email-settings-after-reload', new URL(page.url()).pathname === '/msp/settings/email' && (await page.locator('main').innerText()).includes('Nine Minds Managed'));
    await shot('s1-06-email-return');
    await go('/msp/settings/integrations');
    const boundary = await page.locator('main').innerText();
    await check('s1-customer-broad-integration-catalog-denied', /not available/i.test(boundary) && !/QuickBooks|Xero|Stripe|Tactical RMM|NinjaOne/.test(boundary));
    await shot('s1-07-integrations-denied');
    await actor(actors.qa());
    await go('/msp/settings/integrations'); await page.waitForTimeout(2500);
    const sponsor = await page.locator('main').innerText();
    await check('s1-sponsor-separate-signin-does-not-see-customer-binding', !sponsor.includes(APP) && profiles(OZ).length === 0, { sponsorCatalogVisible: !/not available/i.test(sponsor) });
    await shot('s1-08-sponsor-integrations');
    receipt('s1-profile', { customer: profiles(WR), sponsor: profiles(OZ) });

    // ------------------------------------------------------------- 2
    await chapter('2. Staff sign-in and callback: entry points only (no approved identity provider)');
    await ctx.clearCookies(); await go('/auth/msp/signin');
    const signin = await inspect('s2-01-msp-signin');
    const ssoButtons = signin.inputs.filter((x) => /microsoft|google|sso/i.test(x.id + ' ' + x.text));
    await mark('s2-signin-sso-entries', { ssoButtons });
    await shot('s2-01-msp-signin');
    await actor(actors.alice());
    await go('/msp/security-settings'); await page.getByRole('tab', { name: 'Single Sign-On' }).click(); await page.waitForTimeout(2000);
    const ssoTab = await page.locator('main').innerText();
    await mark('s2-customer-sso-settings', { microsoftStatus: (ssoTab.match(/Microsoft 365 \(Azure AD\)\s*\n\s*([^\n]+)/) || [])[1], bulkMicrosoftDisabled: await page.locator('#bulk-sso-provider-microsoft-button').isDisabled() });
    await shot('s2-02-customer-sso-settings');

    // ------------------------------------------------------------- 3
    await chapter('3. Directory provisioning entry (customer workspace)');
    const tabs = await page.getByRole('tab').allInnerTexts();
    await go('/msp/co-management/providers'); await page.locator('#provider-credentials-microsoft-tab').click(); await page.waitForTimeout(1500);
    const entra = await page.locator('main').innerText();
    await mark('s3-directory-entry-points', { securityTabs: tabs, hasUserProvisioningTab: tabs.some((t) => /provision|scim/i.test(t)), entraDirect: (entra.match(/Entra Direct[\s\S]{0,200}/) || [''])[0].replace(/\s+/g, ' ') });
    await shot('s3-01-entra-direct');

    // ------------------------------------------------------------- 4
    await chapter('4. Requester-audience message reaches the controlled mailbox (SMTP sink); private bodies excluded');
    let contactId = sql(`select contact_name_id from contacts where tenant='${WR}' and email='${esc(REQ_EMAIL)}'`);
    if (!contactId) {
      await go('/msp/contacts'); await page.locator('#new-contact-dialog-button').click(); await page.locator('#quick-add-contact-name').waitFor();
      await page.locator('#quick-add-contact-name').fill(REQ_NAME); await page.getByPlaceholder('name@example.com').first().fill(REQ_EMAIL);
      await page.locator('#quick-add-contact-client-trigger').click(); await page.getByRole('option', { name: /White Rabbit IT/ }).first().click();
      await shot('s4-01-contact-form'); await page.locator('#quick-add-contact-submit').click();
      contactId = await until(() => sql(`select contact_name_id from contacts where tenant='${WR}' and email='${esc(REQ_EMAIL)}'`), 'contact saved');
    }
    let ticketId = sql(`select ticket_id from tickets where tenant='${WR}' and title='${esc(TICKET)}'`);
    if (!ticketId) {
      await go('/msp/tickets');
      for (let i = 0; i < 6 && !await page.locator('#ticket-quick-add-title').isVisible(); i++) { await page.locator('#add-ticket-button').click(); await page.locator('#ticket-quick-add-title').waitFor({ timeout: 15000 }).catch(() => {}); }
      await page.locator('#ticket-quick-add-title').fill(TICKET);
      await page.locator('#ticket-quick-add-client-trigger').click(); await page.getByRole('option', { name: /White Rabbit IT/ }).first().click();
      await page.waitForTimeout(800);
      await page.locator('#ticket-quick-add-contact').click(); await page.getByRole('option', { name: new RegExp(REQ_NAME) }).first().click();
      await page.locator('#ticket-quick-add-board-picker').click(); await page.getByRole('option', { name: /Service Desk/ }).first().click();
      await page.waitForTimeout(800);
      await page.locator('#ticket-quick-add').click(); await page.locator('[role="option"]:not([aria-disabled="true"])').filter({ visible: true }).first().click();
      await shot('s4-02-ticket-form');
      await page.locator('#ticket-quick-add-create-open-btn').click();
      await page.waitForURL(/\/msp\/tickets\/[a-f0-9-]{36}/, { timeout: 90000 });
      ticketId = await until(() => sql(`select ticket_id from tickets where tenant='${WR}' and title='${esc(TICKET)}'`), 'ticket saved');
    }
    await check('s4-disposable-ticket-has-requester-contact', sql(`select contact_name_id from tickets where ticket_id='${ticketId}'`) === contactId, { ticketId, contactId });
    const before = (await sink()).length;
    const post = async (audience, text) => {
      if (Number(sql(`select count(*) from comments where ticket_id='${ticketId}' and note::text like '%${esc(text)}%'`)) > 0) return;
      await page.locator('#ticket-details-conversation-show-comment-editor-btn').click();
      await page.locator('#ticket-details-conversation-audience-select').click(); await page.getByRole('option', { name: audience, exact: true }).click();
      await page.locator('[contenteditable=true]').last().fill(text);
      await page.locator('#ticket-details-conversation-add-comment-btn').click();
      await page.getByText(text, { exact: false }).first().waitFor({ timeout: 30000 });
    };
    await go('/msp/tickets/' + ticketId); await page.locator('#ticket-details-conversation-show-comment-editor-btn').waitFor({ timeout: 60000 });
    await post('Shared IT teams', MSG.shared);
    await post('Private to White Rabbit IT', MSG.priv);
    await post('Requester and IT teams', MSG.requester);
    await shot('s4-03-three-audiences');
    const mails = await until(async () => { const m = (await sink()).filter((x) => to(x).includes(REQ_EMAIL) && body(x).includes(MSG.requester)); return m.length ? m : null; }, 'requester mail delivered to SMTP sink', 120000);
    await page.waitForTimeout(5000);
    const all = (await sink()).filter((x) => to(x).includes(REQ_EMAIL));
    await check('s4-requester-mail-delivered-once-to-controlled-mailbox', mails.length === 1, { recipient: REQ_EMAIL, subject: mails[0].subject, messageId: mails[0].messageId, references: mails[0].references, provider: 'review SMTP sink (simulator), not a real provider' });
    const leaked = all.filter((m) => body(m).includes(MSG.shared) || body(m).includes(MSG.priv)).map((m) => ({ subject: m.subject, messageId: m.messageId, containsShared: body(m).includes(MSG.shared), containsPrivate: body(m).includes(MSG.priv) }));
    const audienceRows = json(`select comment_id,is_internal,case when note like '%shared-IT-only%' then 'shared' when note like '%private customer note%' then 'private' when note like '%requester-audience%' then 'requester' else 'other' end as message from comments where ticket_id='${ticketId}' order by created_at`);
    // Recorded as a finding (not thrown) so the remaining sections are still exercised in this recording.
    await mark(leaked.length ? 's4-FAIL-shared-it-body-emailed-to-requester' : 's4-requester-mails-exclude-shared-and-private-bodies', { requesterMails: all.length, leaked, privateExcluded: !leaked.some((x) => x.containsPrivate), audienceRows });
    receipt('s4-audience-finding', { leaked, audienceRows });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.getByText(MSG.requester).first().waitFor({ timeout: 30000 });
    await shot('s4-04-after-reload');
    receipt('s4-mail', { ticketId, contactId, recipient: REQ_EMAIL, deliveries: all.map((m) => ({ subject: m.subject, messageId: m.messageId, inReplyTo: m.inReplyTo, bodySha256: crypto.createHash('sha256').update(body(m)).digest('hex') })) });
    await mark('s4-reply-ingestion-not-possible', { reason: 'No inbound mailbox/provider binding is configured for White Rabbit (Inbound: Gmail 0, Microsoft 0, IMAP 0) and the SMTP sink accepts outbound mail only.' });

    // ------------------------------------------------------------- 5
    await chapter('5. Revoke the test binding through the provider control (archive) and reload');
    await go('/msp/co-management/providers'); await page.locator('#provider-credentials-microsoft-tab').click(); await page.getByText(APP).first().waitFor();
    const pid = profiles(WR).find((p) => p.display_name === APP).profile_id;
    if (!profiles(WR).find((p) => p.profile_id === pid).is_archived) {
      await page.locator('#microsoft-profile-archive-' + pid).click();
      await page.locator('#microsoft-profile-archive-confirmation-confirm').click();
      await until(() => profiles(WR).find((p) => p.profile_id === pid).is_archived, 'profile archived', 30000);
    }
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.locator('#provider-credentials-microsoft-tab').click(); await page.waitForTimeout(2000);
    await check('s5-test-binding-archived-after-reload', profiles(WR).find((p) => p.profile_id === pid).is_archived === true, { profile: profiles(WR) });
    await shot('s5-01-archived');
    receipt('profilesAfter', { customer: profiles(WR), sponsor: profiles(OZ) });
    return { status: 'partial', limitations: [
      'Configuration saved with the operator-prepared Graph simulator client (cm-review-rabbit-client); simulator evidence only.',
      'Staff sign-in/callback not executable: the MSP sign-in page offers no SSO entry and production-mode SSO is disabled; no approved Microsoft Entra app with a public redirect URI.',
      'Directory provisioning not executable: the customer Security Settings expose no user-provisioning/SCIM tab and Entra Direct has no enabled app.',
      'Reply ingestion not executable: no inbound mailbox binding; the SMTP sink is outbound only.',
      'Revocation exercised only as archiving the test binding; no send/sync/ingest attempt exists to replay against it; lifecycle (departure/lapse) queue checks not run.'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
