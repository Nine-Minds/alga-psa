import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CO_MANAGED_PLANS, coManagedRequirementKeys } from '../lib/co-managed-plan-ids.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'co-managed-plan-ids-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const [name, relative] of Object.entries(CO_MANAGED_PLANS)) {
    for (const file of name === 'foundation' ? [relative] : ['features.json', 'tests.json'].map(file => path.join(relative, file))) {
      const target = path.join(directory, file);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(root, file), target);
    }
  }
  return directory;
}

function changeRows(directory, plan, file, mutate) {
  const target = path.join(directory, CO_MANAGED_PLANS[plan], file);
  const rows = JSON.parse(readFileSync(target, 'utf8'));
  mutate(rows);
  writeFileSync(target, JSON.stringify(rows));
}

test('includes every approved plan and both ticket amendments in the required identity set', () => {
  const result = coManagedRequirementKeys(root);
  assert.deepEqual(result.failures, []);
  assert.equal(result.keys.length, 260);
  for (const key of ['T06', 'clientIntegration:T021', 'ticketList:F049', 'ticketList:T026',
    'CF032', 'CT026', 'nativeTicketScreen:F037', 'nativeTicketScreen:T014']) {
    assert.ok(result.keys.includes(key), `missing ${key}`);
  }
});

test('rejects a removed native-screen requirement', t => {
  const directory = fixture(t);
  changeRows(directory, 'nativeTicketScreen', 'features.json', rows => rows.pop());
  const { failures } = coManagedRequirementKeys(directory);
  assert.ok(failures.includes('nativeTicketScreen:feature: plan carries 36 rows, expected 37'));
  assert.ok(failures.includes('required requirement key missing from the plans: nativeTicketScreen:F037'));
});

test('rejects a removed foundation isolation contract', t => {
  const directory = fixture(t);
  const target = path.join(directory, CO_MANAGED_PLANS.foundation);
  writeFileSync(target, readFileSync(target, 'utf8').replace(/^\| T06 Isolation matrix[^\n]*\n/m, ''));
  const { failures } = coManagedRequirementKeys(directory);
  assert.ok(failures.includes('foundation: plan carries 21 rows, expected 22'));
  assert.ok(failures.includes('required requirement key missing from the plans: T06'));
});

test('rejects replacing a required ID while keeping its plan row count unchanged', t => {
  const directory = fixture(t);
  changeRows(directory, 'ticketList', 'tests.json', rows => { rows[0].id = 'T999'; });
  const { failures } = coManagedRequirementKeys(directory);
  assert.ok(failures.includes('required requirement key missing from the plans: ticketList:T001'));
  assert.ok(failures.includes('unknown requirement key in the plans: ticketList:T999'));
});

test('rejects duplicate IDs even when the plan row count is unchanged', t => {
  const directory = fixture(t);
  changeRows(directory, 'nativeTicketScreen', 'tests.json', rows => { rows[1].id = rows[0].id; });
  const { failures } = coManagedRequirementKeys(directory);
  assert.ok(failures.includes('duplicate requirement key in the plans: nativeTicketScreen:T001'));
  assert.ok(failures.includes('required requirement key missing from the plans: nativeTicketScreen:T002'));
});

test('rejects a new requirement until the approved identity baseline is updated', t => {
  const directory = fixture(t);
  changeRows(directory, 'nativeTicketScreen', 'features.json', rows => rows.push({ id: 'F038' }));
  const { failures } = coManagedRequirementKeys(directory);
  assert.ok(failures.includes('nativeTicketScreen:feature: plan carries 38 rows, expected 37'));
  assert.ok(failures.includes('unknown requirement key in the plans: nativeTicketScreen:F038'));
});
