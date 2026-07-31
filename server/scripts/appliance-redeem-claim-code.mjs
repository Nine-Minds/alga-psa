#!/usr/bin/env node
import { readStdin, runLicenseWorkflow, workflowError } from './appliance-license-workflow.mjs';
try {
  const { claimCode } = await readStdin();
  const result = await runLicenseWorkflow({ workflowType: 'applianceLicenseRedeemWorkflow', input: { claimCode } });
  console.log(JSON.stringify({ ok: true, result }));
} catch (error) { console.log(JSON.stringify(workflowError(error))); process.exitCode = 1; }
