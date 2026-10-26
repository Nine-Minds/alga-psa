// Guide 06 — Projects and tasks. White Rabbit IT (active relationship) + Oz MSP (QA).
// Disposable records use the CM-REVIEW-20261026-06 suffix. Product actions are real UI;
// sql() is read-only (receipts and waits only).
const L = require('./lib.cjs'), path = require('path'), crypto = require('crypto');
const { sql, until, origin, ids, json, esc, fs } = L;
const guideDir = path.dirname(__dirname);
const root = process.env.CM_ATTEMPT ? path.join(guideDir, 'attempts') : guideDir;
const name = process.env.CM_SCENARIO || 'recording';
const SFX = 'CM-REVIEW-20261026-06';
const RUN = process.env.CM_RUN ? ' ' + process.env.CM_RUN : '';
const P_SHARED = SFX + RUN + ' Shared rollout', P_PRIVATE = SFX + RUN + ' Unshared private', PHASE = SFX + ' Phase';
const TASKS = [SFX + RUN + ' Task A', SFX + RUN + ' Task B'];
const fixFile = path.join(guideDir, 'fixtures.json');
const C = ids.customer, R = ids.relationship;
const taskRoute = (t) => `/msp/co-management/tasks/${C}/${R}/${t}`;
const projectRoute = (p) => `/msp/co-management/projects/${C}/${R}/${p}`;
const receipts = {};
const limitations = [];
const receipt = (k, v) => { receipts[k] = v; fs.writeFileSync(path.join(guideDir, 'db-receipts.json'), JSON.stringify(receipts, null, 2)); };

(async () => {
  const r = await L.scenario(root, name, async ({ page, ctx, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    const opt = (n) => page.getByRole('option', { name: n, exact: true });
    const pick = async (trigger, n) => { await page.locator(trigger).click(); await opt(n).click(); };
    const projectId = (n) => sql(`select project_id from projects where tenant='${C}' and project_name='${esc(n)}'`);
    const task = (t) => json(`select task_id,task_name,assigned_to,due_date,project_status_mapping_id,updated_at from project_tasks where tenant='${C}' and task_id='${t}'`)[0];
    receipt('staffAssignmentsBefore', json(`select principal_type,principal_id,relationship_role from co_management_staff_assignments where tenant='${ids.oz}' and customer_tenant='${C}' and relationship_id='${R}'`));
    receipt('projectScopesBefore', json(`select project_id,can_collaborate from co_management_project_scopes where tenant='${C}' and relationship_id='${R}'`));

    // ---------------------------------------------------------------- Before you start
    await chapter('Before you start: customer creates a disposable project, phase and two tasks');
    await actor(L.alice());
    async function createProject(n) {
      let id = projectId(n);
      if (!id) {
        await go('/msp/projects'); await page.locator('#add-project-button').click();
        const dialog = page.getByRole('dialog');
        await dialog.getByPlaceholder('Project Name *', { exact: true }).fill(n);
        await dialog.getByRole('combobox').filter({ hasText: 'Select Status' }).click(); await opt('Not Started').click();
        await dialog.locator('#client-picker-trigger').click(); await page.getByRole('option', { name: /White Rabbit IT/ }).click();
        await shot('prep-project-dialog-' + (n === P_SHARED ? 'shared' : 'private'));
        await dialog.locator('#create-button').click();
        id = await until(() => projectId(n), 'project committed ' + n);
      }
      await go('/msp/projects/' + id); return id;
    }
    const pid = await createProject(P_SHARED);
    let phaseId = sql(`select phase_id from project_phases where tenant='${C}' and project_id='${pid}' and phase_name='${esc(PHASE)}'`);
    if (!phaseId) {
      await page.locator('#add-phase-button').click(); await page.getByPlaceholder('Phase name... *', { exact: true }).fill(PHASE);
      await page.locator('#save-phase-button').click();
      phaseId = await until(() => sql(`select phase_id from project_phases where tenant='${C}' and project_id='${pid}' and phase_name='${esc(PHASE)}'`), 'phase committed');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    }
    const taskIds = [];
    for (const tn of TASKS) {
      let tid = sql(`select task_id from project_tasks where tenant='${C}' and phase_id='${phaseId}' and task_name='${esc(tn)}'`);
      if (!tid) {
        await page.getByText(PHASE, { exact: true }).first().click(); await page.locator('#add-task-button').click();
        await page.getByPlaceholder('Enter task name...', { exact: true }).fill(tn); await page.locator('#save-button').click();
        tid = await until(() => sql(`select task_id from project_tasks where tenant='${C}' and phase_id='${phaseId}' and task_name='${esc(tn)}'`), 'task committed ' + tn);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
      }
      taskIds.push(tid);
    }
    await page.getByText(PHASE, { exact: true }).first().click();
    for (const tn of TASKS) await page.getByText(tn, { exact: true }).first().waitFor();
    // customer-local ownership on Task A (native task drawer)
    if (!sql(`select coalesce(assigned_to::text,'') from project_tasks where tenant='${C}' and task_id='${taskIds[0]}'`)) {
      await go('/msp/projects/' + pid + '/tasks/' + taskIds[0]);
      await page.locator('#user-and-team-picker-trigger').last().click();
      await page.getByText('Alice Liddell', { exact: true }).filter({ visible: true }).last().click();
      await shot('prep-customer-local-assignee'); await page.locator('#save-button').click();
      await until(() => sql(`select coalesce(assigned_to::text,'') from project_tasks where tenant='${C}' and task_id='${taskIds[0]}'`), 'customer-local assignee saved');
    }
    await check('prep-task-a-has-customer-local-assignee', Boolean(sql(`select assigned_to from project_tasks where tenant='${C}' and task_id='${taskIds[0]}'`)));
    await check('prep-native-project-phase-two-tasks-after-reload', taskIds.length === 2, { pid, phaseId, taskIds });
    await shot('prep-native-two-tasks');
    const unsharedId = await createProject(P_PRIVATE);
    await check('prep-second-unshared-project-exists', Boolean(unsharedId), { unsharedId });
    const fixture = { projectId: pid, projectName: P_SHARED, phaseId, taskIds, taskNames: TASKS, unsharedProjectId: unsharedId, unsharedProjectName: P_PRIVATE,
      links: { mspProject: origin + projectRoute(pid), mspTasks: taskIds.map((t) => origin + taskRoute(t)), customerProject: origin + '/msp/projects/' + pid } };
    fs.writeFileSync(fixFile, JSON.stringify(fixture, null, 2));
    receipt('originalTasks', taskIds.map(task));
    const T = taskIds[0];

    // ---------------------------------------------------------------- 1
    await chapter('1. Share only the prepared project (customer grants Collaborate)');
    await go('/msp/co-management');
    const access = page.locator('#co-policy-project-access-' + pid);
    if (!await access.count()) {
      await page.locator('#co-policy-project-search').fill(P_SHARED); await page.waitForTimeout(900);
      await page.locator('#co-policy-project-select').click(); await opt(P_SHARED).click();
      await page.locator('#co-policy-project-add').click();
      await access.click(); await opt('Collaborate').click(); await shot('s1-customer-project-collaborate');
      await page.locator('#co-policy-save').click(); await page.getByText('Access settings saved.', { exact: true }).waitFor();
    }
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await access.waitFor();
    await check('s1-customer-project-collaborate-survives-reload', (await access.innerText()).includes('Collaborate'));
    await check('s1-unshared-project-not-granted', await page.locator('#co-policy-project-access-' + unsharedId).count() === 0);
    receipt('projectScopesAfterGrant', json(`select project_id,can_collaborate from co_management_project_scopes where tenant='${C}' and relationship_id='${R}'`));
    await shot('s1-customer-grant-reloaded');

    await chapter('1. MSP staff assignment for the customer and project task queues');
    await actor(L.qa());
    await go('/msp/clients/' + ids.client + '?tab=co-managed');
    const qaAccess = page.locator('#co-policy-user-access-' + ids.qaId);
    await page.locator('#co-policy-user-title').waitFor();
    let addedQa = false;
    if (!await qaAccess.count()) {
      await page.locator('#co-policy-user-search').fill('QA'); await page.waitForTimeout(900);
      await page.locator('#co-policy-user-select').click(); await page.getByRole('option', { name: /QA Tester/ }).click();
      await page.locator('#co-policy-user-add').click(); await qaAccess.click(); await opt('Collaborate').click();
      await page.locator('#co-policy-save').click();
      await until(() => sql(`select relationship_role from co_management_staff_assignments where tenant='${ids.oz}' and customer_tenant='${C}' and principal_id='${ids.qaId}'`) === 'technician', 'QA technician assignment committed');
      addedQa = true;
    }
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await qaAccess.waitFor();
    await check('s1-qa-technician-assignment-present-after-reload', (await qaAccess.innerText()).includes('Collaborate'), { addedByThisRun: addedQa });
    receipt('staffAssignmentsDuring', json(`select principal_type,principal_id,relationship_role from co_management_staff_assignments where tenant='${ids.oz}' and customer_tenant='${C}' and relationship_id='${R}'`));
    await shot('s1-msp-staff-assignment');

    await go(projectRoute(unsharedId));
    await page.getByRole('alert').first().waitFor();
    await check('s1-unshared-project-unavailable-to-msp', !(await page.locator('body').innerText()).includes(P_PRIVATE));
    await shot('s1-unshared-project-denied');

    await go('/msp/co-management/tasks');
    await page.locator('#co-task-queue-search').fill(SFX + RUN); await page.locator('#co-task-queue-search-submit').click();
    const qlink = (tn) => page.getByRole('link', { name: tn, exact: true });
    await page.getByText(/No permitted tasks match|tasks ·/).first().waitFor(); await page.waitForTimeout(1200);
    await check('s1-working-queue-excludes-unassigned-shared-tasks', await qlink(TASKS[0]).count() === 0 && await qlink(TASKS[1]).count() === 0, { note: 'sharing alone creates no MSP working row' });
    await shot('s1-working-queue-before-assignment');
    await pick('#co-task-queue-view', 'Customer oversight'); await qlink(TASKS[0]).waitFor();
    await check('s1-oversight-view-lists-both-shared-tasks', await qlink(TASKS[1]).count() === 1);
    await shot('s1-oversight-queue');
    const href = await qlink(TASKS[0]).getAttribute('href');
    await check('s1-queue-link-is-customer-and-relationship-qualified', href.includes(C) && href.includes(R) && href.includes(T), { href });
    await qlink(TASKS[0]).click(); await page.locator('#co-project-task-name').waitFor();
    await check('s1-followed-queue-link-opens-shared-task', page.url().endsWith(taskRoute(T)), { url: page.url() });

    // ---------------------------------------------------------------- 2
    await chapter('2. Persist a task edit with attribution');
    const edited = TASKS[0] + ' MSP edit';
    await page.locator('#co-project-task-name').fill(edited); await shot('s2-msp-edit');
    await page.locator('#co-project-task-save').click();
    await until(() => task(T).task_name === edited, 'MSP task name persisted');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.locator('#co-project-task-name').waitFor();
    await until(async () => await page.locator('#co-project-task-name').inputValue() === edited, 'edited name after reload');
    await check('s2-msp-edit-survives-reload', true, { edited });
    const history = page.locator('section[aria-labelledby=co-project-task-history-title]');
    await history.locator('li').first().waitFor();
    const htext = await history.innerText();
    await check('s2-history-records-qualified-author', htext.includes('QA Tester') && /Oz|Emerald/i.test(htext), { history: htext.slice(0, 600) });
    await shot('s2-history');
    await actor(L.alice());
    await go('/msp/projects/' + pid + '/tasks/' + T);
    const nativeName = page.getByPlaceholder('Enter task name...', { exact: true });
    await nativeName.waitFor();
    await check('s2-customer-native-task-shows-msp-edit', await nativeName.inputValue() === edited);
    await shot('s2-customer-native-task');
    await actor(L.qa()); await go(taskRoute(T));
    await page.locator('#co-project-task-name').fill(TASKS[0]); await page.locator('#co-project-task-save').click();
    await until(() => task(T).task_name === TASKS[0], 'task name restored');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await history.locator('li').first().waitFor();
    await check('s2-restored-by-ordinary-save-history-retained', (await history.locator('li').count()) >= 2, { history: (await history.innerText()).slice(0, 600) });

    // ---------------------------------------------------------------- 3
    await chapter('3. Separate MSP assignment from customer-local ownership');
    const localOwner = task(T).assigned_to;
    await page.locator('#co-task-assignment-kind').click(); await opt('Technician').click();
    await page.locator('#co-task-assignment-person').click();
    const offered = (await page.getByRole('option').allInnerTexts()).map((s) => s.trim());
    await check('s3-only-eligible-assigned-principals-offered', offered.some((o) => /QA Tester/.test(o)) && !offered.some((o) => /Tin|Scarecrow|Dorothy|Glinda|Hatter|Cheshire|Queen/.test(o)), { offered });
    await page.getByRole('option', { name: /QA Tester/ }).click(); await shot('s3-assign-technician');
    await page.locator('#co-task-assignment-save').click();
    await page.locator('#co-task-assignment-clear').waitFor();
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.locator('#co-task-assignment-clear').waitFor();
    await check('s3-msp-assignment-persists-and-keeps-local-owner', Boolean(localOwner) && task(T).assigned_to === localOwner, { localOwner });
    receipt('mspTaskAssignment', json(`select * from co_managed_project_task_references where tenant='${ids.oz}' and task_id='${T}'`));
    await go('/msp/co-management/tasks');
    await page.locator('#co-task-queue-search').fill(SFX + RUN); await page.locator('#co-task-queue-search-submit').click();
    await qlink(TASKS[0]).waitFor();
    await check('s3-working-queue-lists-msp-assigned-task-only', await qlink(TASKS[1]).count() === 0);
    await pick('#co-task-queue-assignment', 'Assigned to me'); await qlink(TASKS[0]).waitFor();
    await check('s3-assigned-to-me-shows-assigned-task-only', await qlink(TASKS[1]).count() === 0);
    await shot('s3-assigned-to-me');
    await pick('#co-task-queue-assignment', 'Assigned to my teams'); await page.waitForTimeout(1500);
    const teamText = await page.locator('main').innerText();
    await mark('s3-assigned-to-my-teams-observed', { listsTaskA: teamText.includes(TASKS[0]) });
    await shot('s3-assigned-to-my-teams');
    await qlink(TASKS[0]).count() || await pick('#co-task-queue-assignment', 'Assigned to me');
    await go(taskRoute(T));
    await page.locator('#co-task-assignment-clear').click();
    await until(async () => await page.locator('#co-task-assignment-clear').count() === 0, 'assignment removed');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.locator('#co-task-assignment-kind').waitFor();
    await check('s3-removed-msp-assignment-keeps-local-owner', await page.locator('#co-task-assignment-clear').count() === 0 && task(T).assigned_to === localOwner);
    await go('/msp/co-management/tasks');
    await page.locator('#co-task-queue-search').fill(SFX + RUN); await page.locator('#co-task-queue-search-submit').click();
    await pick('#co-task-queue-assignment', 'Assigned to me'); await page.waitForTimeout(2000);
    await check('s3-assigned-to-me-empty-after-removal', await qlink(TASKS[0]).count() === 0);
    await shot('s3-after-removal');

    // ---------------------------------------------------------------- 4 (stale)
    await chapter('4. Detect a stale MSP edit after a newer customer save');
    await go(taskRoute(T)); await page.locator('#co-project-task-name').waitFor();
    await page.locator('#co-project-task-name').fill(TASKS[0] + ' stale MSP');
    const second = await ctx.browser().newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: dir + '/customer-concurrent', size: { width: 1440, height: 1000 } } });
    const customerName = TASKS[0] + ' customer current';
    try {
      const cp = await L.formLogin(second, L.alice());
      await cp.goto(origin + '/msp/projects/' + pid + '/tasks/' + T, { waitUntil: 'domcontentloaded' });
      const n = cp.getByPlaceholder('Enter task name...', { exact: true }); await n.waitFor();
      await n.fill(customerName); await cp.locator('#save-button').click();
      await until(() => task(T).task_name === customerName, 'customer native save committed');
      await cp.screenshot({ path: dir + '/s4-customer-native-save.png', fullPage: true });
      await mark('s4-customer-saved-newer-value-on-native-task', { customerName });
    } finally { await second.close(); }
    await page.locator('#co-project-task-save').click();
    await page.getByRole('alert').filter({ hasText: /changed|reload|refresh|newer/i }).first().waitFor();
    await check('s4-stale-msp-save-refused-customer-value-kept', task(T).task_name === customerName);
    await shot('s4-stale-conflict');
    const reloadBtn = page.locator('#co-project-task-reload, #co-project-task-discard').first();
    await reloadBtn.click();
    await until(async () => await page.locator('#co-project-task-name').inputValue() === customerName, 'discard and reload shows current');
    await check('s4-discard-and-reload-shows-current-values', true);
    const hAfter = await history.innerText();
    await mark('s4-history-after-customer-native-save', { customerChangeListed: hAfter.includes('customer current'), history: hAfter.slice(0, 900) });
    await page.locator('#co-project-task-name').fill(TASKS[0]); await page.locator('#co-project-task-save').click();
    await until(() => task(T).task_name === TASKS[0], 'name restored after conflict');

    // ---------------------------------------------------------------- 5
    await chapter('5. Compare effort on the shared task (customer and MSP time)');
    const stamp = Date.now(), entries = [];
    async function logTime(who, minutes) {
      await actor(who === 'qa' ? L.qa() : L.alice()); await go(taskRoute(T));
      await page.locator('#co-shared-log-time').click();
      await until(async () => await page.locator('#time-entry-dialog-duration-hours-0').count() || /No time periods are set up/.test(await page.locator('body').innerText()), 'time dialog or period notice');
      if (!await page.locator('#time-entry-dialog-duration-hours-0').count()) {
        const notice = (await page.locator('body').innerText()).match(/No time periods are set up[^\n]*/)[0];
        await shot('s5-' + who + '-time-blocked'); await mark('s5-' + who + '-time-entry-blocked', { notice });
        limitations.push(`${who === 'qa' ? 'Oz' : 'White Rabbit IT'} has no time period covering today; Log time shows "${notice}". Time for this organization was not recorded (creating tenant time periods is outside this guide's scope).`);
        return false;
      }
      const svc = page.getByRole('combobox').filter({ hasText: /Select a service/i });
      if (await svc.count()) { await svc.first().click(); await page.locator('[role=option]:not([aria-disabled="true"])').filter({ visible: true }).first().click(); }
      await page.locator('#time-entry-dialog-duration-hours-0').fill('0');
      await page.locator('#time-entry-dialog-duration-minutes-0').fill(String(minutes));
      const note = `${SFX} ${who} task time ${stamp}`;
      await page.locator('#time-entry-dialog-notes-0').fill(note); await shot('s5-' + who + '-time-dialog');
      await page.locator('#time-entry-dialog-save-dialog-btn').click();
      const row = await until(() => json(`select entry_id,tenant,billing_mode,billable_duration,work_item_type,work_item_id,extract(epoch from(end_time-start_time))/60 as minutes from time_entries where notes='${esc(note)}'`)[0], who + ' time saved');
      entries.push(row); receipt('timeEntries', entries);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.locator('section[aria-label="Recorded effort"]').waitFor();
      await check('s5-' + who + '-time-persisted-on-same-task', Number(row.minutes) === minutes, { row });
      return true;
    }
    const before = json(`select coalesce(sum(extract(epoch from(end_time-start_time))/60),0) as m from time_entries where notes like '${SFX}%'`)[0];
    const logged = { alice: await logTime('alice', 6), qa: await logTime('qa', 12) };
    const expected = [logged.alice ? '0.1 hours' : '0 hours', logged.qa ? '0.2 hours' : '0 hours', logged.alice && logged.qa ? '0.3 hours' : logged.qa ? '0.2 hours' : logged.alice ? '0.1 hours' : '0 hours'];
    const effort = page.locator('section[aria-label="Recorded effort"]');
    await until(async () => (await effort.locator('dd').allTextContents()).length >= 3, 'effort values');
    await until(async () => JSON.stringify(await effort.locator('dd').allTextContents()) === JSON.stringify(expected), 'effort arithmetic ' + expected.join('/')).catch(() => {});
    await check('s5-task-effort-shows-customer-msp-combined', JSON.stringify(await effort.locator('dd').allTextContents()) === JSON.stringify(expected), { expected, displayed: await effort.locator('dd').allTextContents(), minutesLoggedThisRun: { customer: 6, msp: 12 }, priorSuffixMinutes: before.m });
    const taskEffort = await effort.locator('dd').allTextContents();
    await actor(L.alice()); await go(taskRoute(T)); const ce = page.locator('section[aria-label="Recorded effort"]');
    await until(async () => JSON.stringify(await ce.locator('dd').allTextContents()) === JSON.stringify(expected), 'customer sees same effort');
    await check('s5-customer-sees-same-effort-totals', true, { displayed: await ce.locator('dd').allTextContents() });
    await check('s5-customer-does-not-see-msp-private-time-note', !(await page.locator('body').innerText()).includes(SFX + ' qa task time'));
    await shot('s5-task-effort-customer'); await actor(L.qa());
    await go(projectRoute(pid));
    const pe = page.locator('section[aria-label="Recorded effort"]'); await pe.waitFor();
    const projectEffort = await pe.locator('dd').allTextContents();
    await check('s5-project-total-equals-task-total-counted-once', JSON.stringify(projectEffort) === JSON.stringify(taskEffort), { projectEffort, taskEffort });
    await shot('s5-project-effort');

    await chapter('5. Task conversation and file while the grant is active');
    await go(taskRoute(T));
    await page.locator('#co-task-conversation-new').click();
    const msg = `${SFX} shared task message ${stamp}`;
    await page.locator('#co-task-conversation-message [contenteditable=true], #co-task-conversation-message').first().click();
    await page.keyboard.type(msg);
    await page.locator('#co-task-conversation-submit').click();
    const item = page.locator('li[id^=co-task-comment-]').filter({ hasText: msg }); await item.waitFor();
    await item.locator('button[id$=-add]').click();
    const fileName = 'cm-review-20261026-06-' + stamp + '.txt', bytes = Buffer.from('Shared task evidence ' + stamp + '\n');
    await item.locator('input[type=file]').setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: bytes });
    await item.locator('button[id$=-upload]').click();
    const link = item.getByRole('link', { name: fileName, exact: true }); await link.waitFor();
    const fileHref = await link.getAttribute('href');
    const own = await ctx.request.get(origin + fileHref);
    await check('s5-msp-task-file-bytes-match', own.ok() && (await own.body()).equals(bytes));
    await shot('s5-task-conversation-file');
    await actor(L.alice()); await go(taskRoute(T));
    await page.getByRole('link', { name: fileName, exact: true }).waitFor();
    const cust = await ctx.request.get(origin + fileHref);
    await check('s5-customer-reads-task-message-and-file-bytes', cust.ok() && (await cust.body()).equals(bytes));

    // ---------------------------------------------------------------- 4 (revocation)
    await chapter('4. Revoke the project grant: fresh MSP reads close');
    await go('/msp/co-management');
    await page.locator('#co-policy-project-remove-' + pid).click(); await page.locator('#co-policy-save').click();
    await page.getByText('Access settings saved.', { exact: true }).waitFor();
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.locator('#co-policy-project-title').waitFor();
    await check('s4-customer-project-grant-removed-after-reload', await page.locator('#co-policy-project-access-' + pid).count() === 0);
    receipt('projectScopesAfterRevoke', json(`select project_id,can_collaborate from co_management_project_scopes where tenant='${C}' and relationship_id='${R}'`));
    await actor(L.qa()); await go(taskRoute(T));
    await page.getByRole('alert').first().waitFor();
    const body = await page.locator('body').innerText();
    await check('s4-revoked-task-closes-editor-conversation', await page.locator('#co-project-task-name').count() === 0 && !body.includes(msg) && !body.includes(TASKS[0]));
    await shot('s4-revoked-task');
    const denied = await ctx.request.get(origin + fileHref);
    await check('s4-copied-task-file-link-denied-after-revocation', !denied.ok(), { status: denied.status() });
    await go('/msp/co-management/tasks'); await pick('#co-task-queue-view', 'Customer oversight');
    await page.locator('#co-task-queue-search').fill(SFX + RUN); await page.locator('#co-task-queue-search-submit').click();
    await page.waitForTimeout(2500);
    await check('s4-revoked-tasks-absent-from-fresh-queue', await qlink(TASKS[0]).count() === 0 && await qlink(TASKS[1]).count() === 0);
    await shot('s4-revoked-queue');
    await actor(L.alice()); await go('/msp/projects/' + pid + '/tasks/' + T);
    await page.getByPlaceholder('Enter task name...', { exact: true }).waitFor();
    await check('s4-customer-keeps-native-task-and-history', await page.getByPlaceholder('Enter task name...', { exact: true }).inputValue() === TASKS[0]);
    receipt('finalTasks', taskIds.map(task));
    fs.writeFileSync(fixFile, JSON.stringify({ ...fixture, fileName, fileHref, message: msg, addedQaAssignment: addedQa, finalProjectGrant: 'revoked' }, null, 2));
    return { status: limitations.length ? 'partial' : 'passed', limitations };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
