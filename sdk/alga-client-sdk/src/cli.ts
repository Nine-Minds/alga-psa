#!/usr/bin/env node
import { Command } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { registerPackCommand } from './commands/pack.js';
import { registerPackProjectCommand } from './commands/pack-project.js';
import { registerPublishCommand } from './commands/publish.js';
import { registerSignCommand } from './commands/sign.js';
import { registerCreateNewProject } from './commands/create-new-project.js';
import { registerCreateUiProject } from './commands/create-ui-project.js';

async function main() {
  const program = new Command();
  program
    .name('alga')
    .description((pkg as any).description || 'Alga Client SDK CLI')
    .version((pkg as any).version)
    .option('--verbose', 'Enable verbose logging', false)
    .option('--json', 'JSON output when supported', false);

  registerCreateNewProject(program);
  registerCreateUiProject(program);
  registerPackCommand(program);
  registerPackProjectCommand(program);
  registerPublishCommand(program);
  registerSignCommand(program);

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
