#!/usr/bin/env node
import { readStdin, runLicenseWorkflow, workflowError } from './appliance-license-workflow.mjs';
try {
  const { licenseKey } = await readStdin();
  const result = await runLicenseWorkflow({ workflowType: 'applianceLicenseApplyWorkflow', input: { licenseKey } });
  console.log(JSON.stringify({ ok: true, result }));
} catch (error) { console.log(JSON.stringify(workflowError(error))); process.exitCode = 1; }
