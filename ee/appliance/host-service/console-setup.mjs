#!/usr/bin/env node
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { persistSetupInputs, validateSetupInputs } from './setup-engine.mjs';

const setupInputsFile = process.env.ALGA_APPLIANCE_SETUP_INPUTS_FILE || '/etc/alga-appliance/setup-inputs.json';

async function collectInputs() {
  if (!process.stdin.isTTY) {
    const lines = fs.readFileSync(0, 'utf8').split(/\r?\n/);
    return {
      channel: (lines[0] || 'stable').trim() || 'stable',
      appHostname: (lines[1] || '').trim(),
      dnsMode: (lines[2] || 'system').trim() || 'system',
      dnsServers: (lines[3] || '').trim(),
      repoUrl: (lines[4] || 'https://github.com/Nine-Minds/alga-psa.git').trim() || 'https://github.com/Nine-Minds/alga-psa.git',
      repoBranch: (lines[5] || '').trim()
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
      repoUrl: (await rl.question('Repo URL override (default: https://github.com/Nine-Minds/alga-psa.git): ')).trim() || 'https://github.com/Nine-Minds/alga-psa.git',
      repoBranch: (await rl.question('Repo branch override (optional): ')).trim()
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
} catch (error) {
  output.write(`Setup input error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
