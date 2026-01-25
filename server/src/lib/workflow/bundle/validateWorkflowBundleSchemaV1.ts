import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { WorkflowBundleImportError } from './workflowBundleImportErrors';

let cachedValidate: Ajv.ValidateFunction | null = null;

const getValidator = (): Ajv.ValidateFunction => {
  if (cachedValidate) return cachedValidate;

  const schemaPath = path.join(process.cwd(), 'ee', 'docs', 'schemas', 'workflow-bundle.v1.schema.json');
  const schemaJson = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  cachedValidate = ajv.compile(schemaJson);
  return cachedValidate;
};

export const validateWorkflowBundleSchemaV1 = (bundle: unknown): void => {
  const validate = getValidator();
  const ok = validate(bundle);
  if (ok) return;

  const errors = validate.errors ?? [];
  const first = errors[0];
  const hint = first
    ? ` (${first.instancePath || first.schemaPath}: ${first.message ?? 'invalid'})`
    : '';

  throw new WorkflowBundleImportError('SCHEMA_VALIDATION_FAILED', `Workflow bundle failed schema validation${hint}.`, {
    status: 400,
    details: { errors }
  });
};

