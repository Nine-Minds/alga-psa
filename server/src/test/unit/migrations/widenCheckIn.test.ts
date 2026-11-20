import { describe, expect, it } from 'vitest';
import {
  addWidenedCheckNotValid,
  validateWidenedCheck,
  promoteWidenedCheck,
} from '../../../../migrations/utils/widenCheckIn.cjs';

// A pg_constraint stand-in for one Citus-distributed table. It renders definitions the way
// pg_get_constraintdef does (`= ANY (ARRAY['x'::text, ...])`, ` NOT VALID` until validated) and,
// like Citus on a distributed table, refuses RENAME CONSTRAINT.
type Constraint = { column: string; values: string[]; convalidated: boolean };

function distributedTable(initial: Record<string, Constraint>) {
  const constraints = new Map<string, Constraint>(Object.entries(initial));
  const statements: string[] = [];
  const render = (c: Constraint) =>
    `CHECK ((${c.column} = ANY (ARRAY[${c.values.map((v) => `'${v.replace(/'/g, "''")}'::text`).join(', ')}])))${c.convalidated ? '' : ' NOT VALID'}`;
  const ident = (sql: string, keyword: string) => new RegExp(`${keyword} "((?:[^"]|"")+)"`).exec(sql)![1].replace(/""/g, '"');
  const literals = (text: string) => [...text.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));

  const knex = {
    schema: { hasTable: async () => true },
    async raw(sql: string, bindings: unknown[] = []) {
      statements.push(sql);
      if (sql.includes('FROM pg_constraint')) {
        const c = constraints.get(String(bindings[1]));
        return { rows: c ? [{ definition: render(c), convalidated: c.convalidated }] : [] };
      }
      if (sql.includes('RENAME CONSTRAINT')) {
        throw new Error('renaming constraints belonging to distributed tables is currently unsupported');
      }
      if (sql.includes('ADD CONSTRAINT')) {
        const name = ident(sql, 'ADD CONSTRAINT');
        if (constraints.has(name)) throw new Error(`constraint "${name}" already exists`);
        const body = sql.slice(sql.indexOf('CHECK'));
        const column = /CHECK \(+"?([a-z_]+)"?/.exec(body)![1];
        constraints.set(name, { column, values: literals(body), convalidated: !/NOT VALID\s*$/.test(sql) });
        return { rows: [] };
      }
      if (sql.includes('VALIDATE CONSTRAINT')) {
        constraints.get(ident(sql, 'VALIDATE CONSTRAINT'))!.convalidated = true;
        return { rows: [] };
      }
      if (sql.includes('DROP CONSTRAINT IF EXISTS')) {
        constraints.delete(ident(sql, 'DROP CONSTRAINT IF EXISTS'));
        return { rows: [] };
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
  };
  return { knex, constraints, statements };
}

const TABLE = 'co_managed_participation_evidence';
const NAME = 'co_managed_participation_evidence_source_type_check';
const spec = { table: TABLE, name: NAME };
const LIVE = ['ticket_handoff', 'work_audit', 'work_snapshot', 'conversation', 'private_conversation'];
const WIDENED = [...LIVE, 'time_entry'];

describe('widenCheckIn on a Citus-distributed table', () => {
  it('widens through add, validate and promote without renaming, leaving one validated check under the original name', async () => {
    const { knex, constraints, statements } = distributedTable({
      [NAME]: { column: 'source_type', values: LIVE, convalidated: true },
    });

    await addWidenedCheckNotValid(knex, { ...spec, column: 'source_type', add: ['time_entry'] });
    await validateWidenedCheck(knex, spec);
    await promoteWidenedCheck(knex, spec);

    expect(statements.some((sql) => sql.includes('RENAME'))).toBe(false);
    expect([...constraints.keys()]).toEqual([NAME]);
    expect(constraints.get(NAME)).toEqual({ column: 'source_type', values: WIDENED, convalidated: true });

    // Re-running the whole chain is a no-op.
    const before = statements.length;
    await addWidenedCheckNotValid(knex, { ...spec, column: 'source_type', add: ['time_entry'] });
    await validateWidenedCheck(knex, spec);
    await promoteWidenedCheck(knex, spec);
    expect(statements.slice(before).every((sql) => sql.includes('FROM pg_constraint'))).toBe(true);
  });

  it('resumes a promote interrupted after the original name was re-added but before it was validated', async () => {
    const { knex, constraints } = distributedTable({
      [`${NAME}_v2`]: { column: 'source_type', values: WIDENED, convalidated: true },
      [NAME]: { column: 'source_type', values: WIDENED, convalidated: false },
    });

    await promoteWidenedCheck(knex, spec);

    expect([...constraints.keys()]).toEqual([NAME]);
    expect(constraints.get(NAME)).toEqual({ column: 'source_type', values: WIDENED, convalidated: true });
  });

  it('resumes a promote interrupted after the old check was dropped', async () => {
    const { knex, constraints } = distributedTable({
      [`${NAME}_v2`]: { column: 'source_type', values: WIDENED, convalidated: true },
    });

    await promoteWidenedCheck(knex, spec);

    expect([...constraints.keys()]).toEqual([NAME]);
    expect(constraints.get(NAME)).toEqual({ column: 'source_type', values: WIDENED, convalidated: true });
  });

  it('refuses to drop the old check while the replacement is unvalidated', async () => {
    const { knex, constraints } = distributedTable({
      [NAME]: { column: 'source_type', values: LIVE, convalidated: true },
      [`${NAME}_v2`]: { column: 'source_type', values: WIDENED, convalidated: false },
    });

    await expect(promoteWidenedCheck(knex, spec)).rejects.toThrow(/is not validated/);
    expect(constraints.get(NAME)?.values).toEqual(LIVE);
  });
});
