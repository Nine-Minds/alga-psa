import { Command } from 'commander';
import { signBundlePlaceholder } from '../core/sign.js';
import { createLogger } from '../core/logger.js';

export function registerSignCommand(program: Command) {
  program
    .command('sign')
    .description('Sign an extension bundle (placeholder)')
    .argument('<bundlePath>', 'Path to bundle file')
    .requiredOption('--algorithm <algo>', 'cosign|x509|pgp')
    .action(async (bundlePath: string, opts: { algorithm: 'cosign' | 'x509' | 'pgp' }) => {
      const logger = createLogger(program.opts().verbose);
      try {
        const res = signBundlePlaceholder(bundlePath, { algorithm: opts.algorithm });
        if (program.opts().json) console.log(JSON.stringify(res, null, 2));
        else logger.info(`[sign] wrote: ${res.signaturePath}`);
      } catch (e) {
        logger.error((e as Error).message);
        process.exit(1);
      }
    });
}

