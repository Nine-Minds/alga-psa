import { Command } from 'commander';
import { packDir } from '../core/pack.js';
import { createLogger } from '../core/logger.js';

export function registerPackCommand(program: Command) {
  program
    .command('pack')
    .description('Pack a directory into a bundle.tar.zst and compute sha256')
    .argument('<inputDir>', 'Directory to pack')
    .argument('<outputPath>', 'Output .tar.zst path')
    .option('--force', 'Overwrite output if exists', false)
    .action(async (inputDir: string, outputPath: string, opts: { force?: boolean }) => {
      const logger = createLogger(program.opts().verbose);
      try {
        const res = await packDir(inputDir, outputPath, { force: opts.force, logger });
        if (program.opts().json) {
          console.log(JSON.stringify(res, null, 2));
        }
      } catch (e) {
        logger.error((e as Error).message);
        process.exit(1);
      }
    });
}

