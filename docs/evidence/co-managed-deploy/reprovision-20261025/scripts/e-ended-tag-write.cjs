// Step 2 of the deploy-fix work order on the admitted production review build:
// a terminated co-managed customer can read but not write tags (Entry, Grid, list, and direct
// server-action POSTs), while an active customer and a native PSA tenant still add and remove tags.
const fs = require('fs'), path = require('path');
const { scenario, credential, sql, until, fixtures, build, worktree } = require('./runtime.cjs');
const root = process.env.CM_ROOT;
const readOnlyMessage = 'This co-managed workspace is read-only. Sign-in, reading, export, and license recovery remain available.';
const fx = fixtures();

const tagRows = (tenant, extra = '') => JSON.parse(sql(`select coalesce(json_agg(x order by x.mapping_id),'[]') from (select m.mapping_id,m.tag_id,d.tag_text,m.tagged_id,m.tagged_type,m.created_by from tag_mappings m join tag_definitions d on d.tenant=m.tenant and d.tag_id=m.tag_id where m.tenant='${tenant}' ${extra}) x`));
const tables = (tenant) => JSON.parse(sql(`select json_build_object('tag_definitions',(select coalesce(json_agg(d order by d.tag_id),'[]') from tag_definitions d where d.tenant='${tenant}'),'tag_mappings',(select coalesce(json_agg(m order by m.mapping_id),'[]') from tag_mappings m where m.tenant='${tenant}'))`));
const counts = (t) => ({ tag_definitions: t.tag_definitions.length, tag_mappings: t.tag_mappings.length });
const relationship = (tenant, id) => JSON.parse(sql(`select row_to_json(r) from (select relationship_id, sponsor_tenant, state, ended_at, updated_at from co_management_relationships where tenant='${tenant}' and relationship_id='${id}') r`));
const definitions = (tenant, text) => Number(sql(`select count(*) from tag_definitions where tenant='${tenant}' and tag_text='${text}'`));
const layout = async (page, name) => { await page.locator(`#ticket-layout-toggle-${name}`).click(); await page.waitForTimeout(1500); };
const affordances = async (page) => ({
  addPopover: await page.locator('#tag-add-button').count(),
  addInline: await page.locator('[id$="-input-button"]').count(),
  remove: await page.locator('button[title="Remove tag"]').count(),
});

// Server-action ids for the tag writers, as compiled into this build, restricted to ones the ticket page serves.
function tagActionIds() {
  const manifest = JSON.parse(fs.readFileSync(`${worktree}/server/${build.dist}/server/server-reference-manifest.json`, 'utf8')).node;
  const wanted = ['createTag', 'updateTagColor', 'updateTagText', 'deleteTag', 'deleteAllTagsByText', 'createTagsForEntity'];
  const ids = {};
  for (const [id, v] of Object.entries(manifest)) {
    if (!String(v.filename).includes('packages/tags/src/actions/tagActions')) continue;
    if (!wanted.includes(v.exportedName)) continue;
    if (!Object.keys(v.workers).some((w) => w.startsWith('app/msp/tickets/[id]/page'))) continue;
    ids[v.exportedName] = id;
  }
  return ids;
}

async function terminated() {
  return scenario(root, 'terminated-customer', async ({ page, actor, go, check, shot, inspect, mark, dir }) => {
    const dep = fx.departing, cred = credential(dep.credentialFile);
    const rel0 = relationship(dep.customer, dep.relationship);
    await check('relationship-terminated-before', rel0?.state === 'terminated' && Boolean(rel0.ended_at), rel0);
    const before = tables(dep.customer);
    const existing = tagRows(dep.customer, `and m.tagged_id='${dep.ticket}'`);
    await check('ticket-has-existing-tag', existing.some((t) => t.tag_text === dep.tag), { existing });
    await actor({ name: 'terminated-customer-admin', email: cred.email, password: cred.password });
    await go('/msp/tickets/' + dep.ticket);
    for (const name of ['entry', 'grid']) {
      await layout(page, name);
      await page.getByText(dep.tag).first().waitFor();
      const a = await affordances(page); await inspect(name + '-tags'); await shot(name + '-tags');
      await check(`${name}-existing-tag-displayed`, true, { tag: dep.tag });
      await check(`${name}-no-tag-add-or-remove-control`, a.addPopover === 0 && a.addInline === 0 && a.remove === 0, a);
    }
    await go('/msp/tickets'); await page.getByText(dep.ticketTitle).first().waitFor(); await page.waitForTimeout(1500);
    const list = await affordances(page); await inspect('ticket-list'); await shot('ticket-list');
    await check('ticket-list-no-tag-mutation-controls', list.addPopover === 0 && list.addInline === 0 && list.remove === 0, list);

    // Direct writes that bypass the UI: POST the compiled tag server actions from the customer's own session.
    await go('/msp/tickets/' + dep.ticket); await page.getByText(dep.tag).first().waitFor();
    const ids = tagActionIds(); await mark('server-action-ids', ids);
    const tagId = existing.find((t) => t.tag_text === dep.tag).tag_id;
    const attempts = [
      ['createTag', [{ tag_text: 'Direct write after departure', tagged_id: dep.ticket, tagged_type: 'ticket' }]],
      ['createTag', [{ tag_text: dep.tag, tagged_id: dep.ticket, tagged_type: 'ticket' }]],
      ['updateTagColor', [tagId, '#FF0000', '#FFFFFF']],
      ['updateTagText', [tagId, 'Renamed after departure']],
      ['deleteTag', [tagId]],
      ['deleteAllTagsByText', [dep.tag, 'ticket']],
      ['createTagsForEntity', [dep.ticket, 'ticket', [{ tag_text: 'Bulk after departure' }]]],
    ];
    const results = [];
    for (const [name, args] of attempts) {
      if (!ids[name]) throw Error('no compiled server action id for ' + name);
      const res = await page.evaluate(async ({ id, args }) => {
        const r = await fetch(location.pathname, { method: 'POST', headers: { 'Next-Action': id, 'Content-Type': 'text/plain;charset=UTF-8', Accept: 'text/x-component' }, body: JSON.stringify(args) });
        return { status: r.status, body: (await r.text()).slice(0, 2000) };
      }, { id: ids[name], args });
      results.push({ action: name, actionId: ids[name], args, ...res });
    }
    fs.writeFileSync(path.join(dir, 'direct-server-action-writes.json'), JSON.stringify(results, null, 2));
    for (const r of results) {
      const refused = r.status === 200 && r.body.includes(readOnlyMessage);
      const emptyBulk = r.action === 'createTagsForEntity' && r.status === 200 && /\[\]/.test(r.body);
      await check(`direct-${r.action}-refused`, refused || emptyBulk, { status: r.status, body: r.body.slice(0, 300) });
    }
    await page.reload(); await page.getByText(dep.tag).first().waitFor(); await shot('after-direct-writes');
    const after = tables(dep.customer), rel1 = relationship(dep.customer, dep.relationship);
    const receipt = { tenant: dep.customer, workspace: dep.workspace, relationship: dep.relationship, ticket: dep.ticket, existingTag: dep.tag,
      build, relationshipBefore: rel0, relationshipAfter: rel1, countsBefore: counts(before), countsAfter: counts(after),
      tablesUnchanged: JSON.stringify(after) === JSON.stringify(before), before, after };
    fs.writeFileSync(path.join(dir, 'db-receipt.json'), JSON.stringify(receipt, null, 2));
    await check('tag-tables-unchanged', receipt.tablesUnchanged, { before: receipt.countsBefore, after: receipt.countsAfter });
    await check('relationship-still-terminated', rel1?.state === 'terminated' && rel1.ended_at === rel0.ended_at, rel1);
  });
}

// Remove one tag through the ticket screen; the last use asks whether to keep the definition.
async function removeThroughProduct(page, text) {
  await page.locator(`span[title="${text}"] button[title="Remove tag"]`).click();
  const deleteDefinition = page.getByRole('button', { name: 'Remove & Delete Definition' });
  await deleteDefinition.waitFor({ state: 'visible', timeout: 15000 }); await deleteDefinition.click();
  await deleteDefinition.waitFor({ state: 'hidden', timeout: 15000 });
}

async function writable(name, who, tenant, ticket) {
  return scenario(root, name, async ({ page, actor, go, check, shot, inspect, dir }) => {
    const tag = 'SMOKE ended-tag control ' + Date.now();
    const before = tables(tenant);
    await actor(who); await go('/msp/tickets/' + ticket); await layout(page, 'entry');
    await page.locator('#tag-add-button').first().click(); await shot('tag-picker');
    await page.locator('#tag-save-button').locator('..').locator('input').fill(tag); await page.locator('#tag-save-button').click();
    await until(() => tagRows(tenant, `and d.tag_text='${tag}' and m.tagged_id='${ticket}'`).length === 1, 'mapping for ' + tag);
    await page.reload(); await page.locator('#ticket-layout-toggle-entry').waitFor(); await page.getByText(tag).first().waitFor();
    const added = tagRows(tenant, `and d.tag_text='${tag}'`); await shot('after-add-reload'); await inspect('after-add-reload');
    await check('tag-persisted', added.length === 1, { added });
    await removeThroughProduct(page, tag);
    await until(() => tagRows(tenant, `and d.tag_text='${tag}'`).length === 0 && definitions(tenant, tag) === 0, 'cleanup of ' + tag);
    await page.reload(); await page.locator('#ticket-layout-toggle-entry').waitFor(); await page.waitForTimeout(1500);
    const visible = await page.getByText(tag).count(); await shot('after-remove-reload');
    const after = tables(tenant);
    fs.writeFileSync(path.join(dir, 'db-receipt.json'), JSON.stringify({ tenant, ticket, tag, build, added, countsBefore: counts(before), countsAfter: counts(after),
      noLeftovers: JSON.stringify(after) === JSON.stringify(before) }, null, 2));
    await check('tag-removed-and-no-leftovers', visible === 0 && JSON.stringify(after) === JSON.stringify(before), { visible, before: counts(before), after: counts(after) });
  });
}

(async () => {
  const results = [];
  results.push(await terminated());
  const alice = credential(fx.active.credentialFile);
  results.push(await writable('active-customer-control', { name: 'active-customer-admin', email: alice.email, password: alice.password }, fx.active.customer, fx.active.ticket));
  results.push(await writable('native-oz-control', { name: 'qa', email: 'qa@emeraldcity.oz', password: credential('continuation-test-login.json').password }, fx.native.tenant, fx.native.ticket));
  const summary = results.map((r) => ({ scenario: r.scenario, status: r.scenarioStatus, error: r.error, build: r.build, assertions: r.assertions.map((a) => a.id) }));
  fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify(summary, null, 2));
  // One receipt at the top of the packet, mirroring the original failure evidence.
  const read = (n) => JSON.parse(fs.readFileSync(path.join(root, n, 'db-receipt.json'), 'utf8'));
  const t = read('terminated-customer'), a = read('active-customer-control'), n = read('native-oz-control');
  fs.writeFileSync(path.join(root, 'db-receipt.json'), JSON.stringify({ build,
    terminated: { tenant: t.tenant, relationship: t.relationship, ticket: t.ticket, existingTag: t.existingTag, relationshipBefore: t.relationshipBefore, relationshipAfter: t.relationshipAfter, countsBefore: t.countsBefore, countsAfter: t.countsAfter, tablesUnchanged: t.tablesUnchanged },
    activeControl: { tenant: a.tenant, ticket: a.ticket, tag: a.tag, countsBefore: a.countsBefore, countsAfter: a.countsAfter, noLeftovers: a.noLeftovers },
    nativeControl: { tenant: n.tenant, ticket: n.ticket, tag: n.tag, countsBefore: n.countsBefore, countsAfter: n.countsAfter, noLeftovers: n.noLeftovers } }, null, 2));
  if (results.some((r) => r.scenarioStatus === 'failed')) process.exitCode = 1;
})();
