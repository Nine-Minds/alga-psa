import { Command } from 'commander';
import { scaffoldTemplate } from '../core/templates.js';
import { createLogger } from '../core/logger.js';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export function registerCreateNewProject(program: Command) {
  program
    .command('create-new-project')
    .description('Create a minimal standalone extension project (hello world, no UI toolkit)')
    .argument('[dir]', 'Target directory', '.')
    .option('--name <name>', 'Package name (defaults to directory name)')
    .action(async (dir: string, opts: { name?: string }) => {
      const logger = createLogger(program.opts().verbose);
      try {
        const target = resolve(dir);
        const name = opts.name || basename(target);
        const root = fileURLToPath(new URL('../../../templates/basic', import.meta.url));
        scaffoldTemplate(root, target, { PACKAGE_NAME: name, DESCRIPTION: 'Alga hello-world extension', SDK_VERSION: '^0.1.0' });
        logger.info(`[create-new-project] scaffolded at ${target}`);
        logger.info('Next steps:');
        logger.info('  - npm install');
        logger.info('  - npm run build');
        logger.info('  - alga pack-project --project . --out dist/bundle.tar.zst');
      } catch (e) {
        logger.error((e as Error).message);
        process.exit(1);
      }
    });
}
