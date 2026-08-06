/**
 * Live smoke driver for alga0002196: exercises the exact write path
 * addStatusToProject runs (ProjectModel.copyProjectStatusMappingsToPhase
 * inside a transaction, then the phase-scoped insert), against the wired
 * dev database. Read-only args decide the mode:
 *   mode=repair   -> clone+remap then insert a custom phase status (DoD-3/4)
 *   mode=verify   -> print phase mappings + task mapping state
 *   mode=revert   -> remap tasks back to project defaults and delete phase clones
 */
import knexFactory from 'knex';
import ProjectModelImport from '../../packages/projects/src/models/project.ts';

// tsx CJS/ESM interop can hand us the module namespace; unwrap defensively.
const ProjectModel: any = (ProjectModelImport as any)?.copyProjectStatusMappingsToPhase
  ? ProjectModelImport
  : (ProjectModelImport as any)?.default ?? ProjectModelImport;

const TENANT = 'dd8cb218-d46d-47f3-be27-8aa50aad5fce';
const PROJECT = '8dbdf12e-087f-4c3f-a0f4-43e182cf6355';
const PHASE = '895a8ede-6eed-454e-9a9d-7815126c8357';

const knex = knexFactory({
  client: 'pg',
  connection: {
    host: '127.0.0.1',
    port: 6472,
    user: 'postgres',
    password: process.env.PGPASSWORD,
    database: 'server',
  },
  pool: { min: 1, max: 2 },
});

async function dump(label: string) {
  const mappings = await knex('project_status_mappings')
    .where({ tenant: TENANT, project_id: PROJECT })
    .orderByRaw('phase_id NULLS FIRST, display_order')
    .select('project_status_mapping_id', 'phase_id', 'is_standard', 'custom_name', 'display_order');
  const tasks = await knex('project_tasks')
    .where({ tenant: TENANT, phase_id: PHASE })
    .select('task_id', 'task_name', 'project_status_mapping_id');
  console.log(`=== ${label} ===`);
  console.log(JSON.stringify({ mappings, tasks }, null, 2));
}

async function main() {
  const mode = process.argv[2] ?? 'verify';
  if (mode === 'verify') {
    await dump('verify');
  } else if (mode === 'repair') {
    await dump('before');
    await knex.transaction(async (trx) => {
      // exact sequence addStatusToProject performs for a phase-scoped add
      await ProjectModel.copyProjectStatusMappingsToPhase(trx, TENANT, PROJECT, PHASE);
      const maxOrder = await trx('project_status_mappings')
        .where({ tenant: TENANT, project_id: PROJECT, phase_id: PHASE })
        .max('display_order as max')
        .first();
      await trx('project_status_mappings').insert({
        tenant: TENANT,
        project_id: PROJECT,
        phase_id: PHASE,
        status_id: null,
        standard_status_id: null,
        is_standard: false,
        custom_name: 'QA Review (smoke)',
        display_order: (Number(maxOrder?.max) || 0) + 1,
        is_visible: true,
      });
    });
    await dump('after');
  } else if (mode === 'revert') {
    await knex.transaction(async (trx) => {
      const defaults = await trx('project_status_mappings')
        .where({ tenant: TENANT, project_id: PROJECT })
        .whereNull('phase_id');
      const phaseScoped = await trx('project_status_mappings')
        .where({ tenant: TENANT, project_id: PROJECT, phase_id: PHASE });
      for (const clone of phaseScoped) {
        const match = defaults.find(
          (d) =>
            (clone.is_standard && d.is_standard && d.standard_status_id === clone.standard_status_id) ||
            (!clone.is_standard && !d.is_standard && d.status_id === clone.status_id && d.custom_name === clone.custom_name)
        );
        if (match) {
          await trx('project_tasks')
            .where({ tenant: TENANT, phase_id: PHASE, project_status_mapping_id: clone.project_status_mapping_id })
            .update({ project_status_mapping_id: match.project_status_mapping_id });
        }
      }
      await trx('project_status_mappings')
        .where({ tenant: TENANT, project_id: PROJECT, phase_id: PHASE })
        .del();
    });
    await dump('after-revert');
  }
  await knex.destroy();
}

main().catch((e) => { console.error(e); process.exit(1); });
