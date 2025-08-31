import { Command } from 'commander';
import { scaffoldTemplate } from '../core/templates.js';
import { createLogger } from '../core/logger.js';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export function registerCreateUiProject(program: Command) {
  program
    .command('create-ui-project')
    .description('Create a standalone project with the client SDK gallery (inline template)')
    .argument('[dir]', 'Target directory', '.')
    .option('--name <name>', 'Package name (defaults to directory name)')
    .action(async (dir: string, opts: { name?: string }) => {
      const logger = createLogger(program.opts().verbose);
      try {
        const target = resolve(dir);
        const name = opts.name || basename(target);
        const root = fileURLToPath(new URL('../../../templates/ui-gallery', import.meta.url));
        scaffoldTemplate(root, target, { PACKAGE_NAME: name, DESCRIPTION: 'Alga UI Gallery extension', SDK_VERSION: '^0.1.0' });
        logger.info(`[create-ui-project] scaffolded at ${target}`);
        logger.info('Next steps:');
        logger.info('  - npm install');
        logger.info('  - npm run dev');
        logger.info('  - Build your UI in src/gallery.tsx and src/index.tsx');
      } catch (e) {
        logger.error((e as Error).message);
        process.exit(1);
      }
    });
}
