// NOTE: This repo has multiple Ajv versions in the dependency tree. Importing from `ajv`
// can resolve to Ajv v6 under `server/node_modules`, which is incompatible with `ajv-formats` (Ajv v8).
// Importing from `ajv/dist/2020.js` ensures we use the workspace-root Ajv v8 build consistently and
// works in ESM/bundler environments that require fully specified file extensions.
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { WorkflowBundleImportError } from './workflowBundleImportErrors';
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json';
import schemaJson from '../../../../../ee/docs/schemas/workflow-bundle.v1.schema.json';

type ValidateFn = ((data: unknown) => boolean) & { errors?: unknown[] };
let cachedValidate: ValidateFn | null = null;

const getValidator = (): ValidateFn => {
  if (cachedValidate) return cachedValidate;

  const ajv = new Ajv({ allErrors: true, strict: false });
  // Our bundle schema declares `$schema: draft-07`. Ajv 2020 doesn't include the draft-07 meta schema by default.
  // Add it explicitly so Ajv can resolve the `$schema` reference during compilation.
  ajv.addMetaSchema(draft7MetaSchema);
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
