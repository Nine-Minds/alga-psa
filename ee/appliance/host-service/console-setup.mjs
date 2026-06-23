#!/usr/bin/env node
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { persistSetupInputs, runSetupWorkflow, validateSetupInputs } from './setup-engine.mjs';

const setupInputsFile = process.env.ALGA_APPLIANCE_SETUP_INPUTS_FILE || '/var/lib/alga-appliance/setup-inputs.json';
const stateFile = process.env.ALGA_APPLIANCE_STATE_FILE || '/var/lib/alga-appliance/install-state.json';

async function collectInputs() {
  if (!process.stdin.isTTY) {
    const lines = fs.readFileSync(0, 'utf8').split(/\r?\n/);
    return {
      channel: (lines[0] || 'stable').trim() || 'stable',
      appHostname: (lines[1] || '').trim(),
      dnsMode: (lines[2] || 'system').trim() || 'system',
      dnsServers: (lines[3] || '').trim(),
      releaseRef: (lines[4] || '').trim(),
      installCode: (lines[5] || '').trim()
    };
  }

  const rl = readline.createInterface({ input, output });
  try {
    output.write('Alga Appliance console setup\n');
    return {
      channel: (await rl.question('Release channel [stable/nightly] (default: stable): ')).trim() || 'stable',
      appHostname: (await rl.question('App URL / hostname (example: psa.example.com): ')).trim(),
      dnsMode: (await rl.question('DNS mode [system/custom] (default: system): ')).trim() || 'system',
      dnsServers: (await rl.question('Custom DNS servers comma-separated (optional): ')).trim(),
      releaseRef: (await rl.question('Release pin (optional; blank follows channel): ')).trim(),
      installCode: (await rl.question('Install code from registration email: ')).trim()
    };
  } finally {
    rl.close();
  }
}

try {
  const raw = await collectInputs();
  const inputs = validateSetupInputs(raw);
  persistSetupInputs(inputs, setupInputsFile);
  output.write(`Setup inputs saved to ${setupInputsFile}\n`);

  const setupResult = await runSetupWorkflow(inputs, { stateFile });
  if (!setupResult.ok) {
    output.write(`Preflight blocked (${setupResult.phase}/${setupResult.step}): ${setupResult.message}\n`);
    output.write(`Suggested next step: ${setupResult.suggestedNextStep}\n`);
    process.exitCode = 1;
  } else {
    output.write('Setup workflow phase completed successfully.\n');
  }
} catch (error) {
  output.write(`Setup input error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
