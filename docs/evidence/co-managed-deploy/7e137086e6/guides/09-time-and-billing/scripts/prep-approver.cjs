// Guide 09 preparation (recorded, native UI): QA had no team-lead role, so the Approvals screen refused
// ("Team lead access required") in attempt run-b. Create a disposable approval team led by QA, then
// return run-b's submitted sheet through the offered "Request changes" workflow so new entries can join it.
const fs = require('fs');
const { scenario, sql, until } = require('../../scripts/runtime.cjs');
const { actors, OZ, fx } = require('./common.cjs');
const TEAM = 'CM-REVIEW-20261026-09 approvers';
const SHEET = 'b1adac9e-430c-4c28-abe8-6389bd9a7e70';
(async () => {
  const r = await scenario(__dirname + '/..', process.env.CM_SCENARIO || 'prep-approver-team', async ({ page, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    const team = () => JSON.parse(sql(`select coalesce(json_agg(t),'[]') from (select team_id,team_name,manager_id from teams where tenant='${OZ}' and team_name='${TEAM}') t`))[0];
    const before = { team: team() || null, sheet: sql(`select approval_status from time_sheets where id='${SHEET}'`) };
    await mark('before', before);
    await actor(actors.qa());
    await chapter('Prep: QA cannot approve without a team-lead role');
    await go('/msp/time-sheet-approvals'); await page.waitForTimeout(1500);
    const denied = (await page.locator('main').innerText()).includes('Team lead access required');
    await mark('approvals-before-team', { teamLeadRequiredShown: denied }); await shot('01-team-lead-required');
    await chapter('Prep: Settings > Teams creates a disposable approval team led by QA');
    if (!team()) {
      await go('/msp/settings?tab=teams'); await page.locator('#add-new-team-btn').click();
      const form = page.locator('#add-new-team-btn').locator('xpath=..');
      await page.locator('input[type=text]').filter({ visible: true }).last().fill(TEAM).catch(() => {});
      await page.getByRole('textbox').filter({ visible: true }).last().fill(TEAM).catch(() => {});
      await shot('02-team-form-name'); await inspect('02-team-form-name');
      const picker = page.locator('#create-team-btn').locator('xpath=../..').getByRole('combobox').or(page.locator('#create-team-btn').locator('xpath=../..').locator('button').filter({ hasText: /manager|Select/i })).first();
      await picker.click(); await page.waitForTimeout(600);
      await page.getByRole('option', { name: /QA Tester/ }).first().click().catch(async () => { await page.getByText('QA Tester', { exact: true }).last().click(); });
      await shot('03-team-form'); await page.locator('#create-team-btn').click();
      await until(() => team(), 'team created');
    }
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.getByText(TEAM).first().waitFor();
    await check('approval-team-led-by-qa-persists', team().manager_id === fx.qaId, { team: team() });
    await shot('04-team-listed');
    await chapter('Prep: return run-b submitted sheet through Request changes');
    await go('/msp/time-sheet-approvals'); await page.waitForTimeout(1500);
    if (sql(`select approval_status from time_sheets where id='${SHEET}'`) === 'SUBMITTED') {
      await page.locator('#view-timesheet-' + SHEET + '-btn').click(); await page.locator('#timesheet-request-changes-btn').waitFor({ timeout: 60000 });
      await shot('05-sheet-in-approval'); await inspect('05-sheet-in-approval');
      await page.locator('#timesheet-request-changes-btn').click();
      const confirm = page.getByRole('dialog').getByRole('button', { name: /request changes|confirm|send/i }); if (await confirm.count()) await confirm.last().click().catch(() => {});
      await until(() => sql(`select approval_status from time_sheets where id='${SHEET}'`) === 'CHANGES_REQUESTED', 'sheet returned');
    }
    await check('run-b-sheet-returned-for-changes', sql(`select approval_status from time_sheets where id='${SHEET}'`) === 'CHANGES_REQUESTED');
    await shot('06-after-return');
    fs.writeFileSync(dir + '/receipt.json', JSON.stringify({ before, after: { team: team(), sheet: sql(`select approval_status from time_sheets where id='${SHEET}'`) } }, null, 2));
    return { status: 'passed', limitations: ['Preparation only. The disposable team is deleted after the guide 09 recording.'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
