import { Command } from 'commander';
import { packProject } from '../core/pack-project.js';
import { createLogger } from '../core/logger.js';

export function registerPackProjectCommand(program: Command) {
  program
    .command('pack-project')
    .description('Stage a bundle from a project directory (using manifest.json) and pack it')
    .requiredOption('--project <path>', 'Project directory')
    .requiredOption('--out <path>', 'Output bundle path (.tar.zst)')
    .option('--force', 'Overwrite output if exists', false)
    .action(async (opts: { project: string; out: string; force?: boolean }) => {
      const logger = createLogger(program.opts().verbose);
      try {
        const res = await packProject(opts.project, opts.out, { force: opts.force, logger });
        if (program.opts().json) console.log(JSON.stringify(res, null, 2));
      } catch (e) {
        logger.error((e as Error).message);
        process.exit(1);
      }
    });
}

