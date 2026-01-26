// NOTE: This repo has multiple Ajv versions in the dependency tree. Importing from `ajv`
// can resolve to Ajv v6 under `server/node_modules`, which is incompatible with `ajv-formats` (Ajv v8).
// Importing from `ajv/dist/2020` ensures we use the workspace-root Ajv v8 build consistently.
import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { WorkflowBundleImportError } from './workflowBundleImportErrors';
import schemaJson from '../../../../../ee/docs/schemas/workflow-bundle.v1.schema.json';

type ValidateFn = ((data: unknown) => boolean) & { errors?: unknown[] };
let cachedValidate: ValidateFn | null = null;

const getValidator = (): ValidateFn => {
  if (cachedValidate) return cachedValidate;

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  cachedValidate = ajv.compile(schemaJson) as ValidateFn;
  return cachedValidate;
};

export const validateWorkflowBundleSchemaV1 = (bundle: unknown): void => {
  const validate = getValidator();
  const ok = validate(bundle);
  if (ok) return;

  const errors = validate.errors ?? [];
  const first = errors[0];
  const hint = (() => {
    if (!first || typeof first !== 'object') return '';
    const err = first as any;
    const at = (err.instancePath || err.schemaPath) ? String(err.instancePath || err.schemaPath) : '';
    const msg = err.message ? String(err.message) : 'invalid';
    return at ? ` (${at}: ${msg})` : ` (${msg})`;
  })();

  throw new WorkflowBundleImportError('SCHEMA_VALIDATION_FAILED', `Workflow bundle failed schema validation${hint}.`, {
    status: 400,
    details: { errors }
  });
};
