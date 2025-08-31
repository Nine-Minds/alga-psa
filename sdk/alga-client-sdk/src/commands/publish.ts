import { Command } from 'commander';
import { publishBundle } from '../core/publish.js';
import { createLogger } from '../core/logger.js';

export function registerPublishCommand(program: Command) {
  program
    .command('publish')
    .description('Publish a bundle to the server via API')
    .requiredOption('--bundle <path>', 'Path to bundle.tar.zst')
    .requiredOption('--manifest <path>', 'Path to manifest.json')
    .option('--declared-hash <sha256>', 'Declared sha256 hash for integrity')
    .option('--cache-control <value>', 'Cache-Control header value')
    .option('--signature <path>', 'Path to SIGNATURE file to include')
    .option('--signature-algorithm <algo>', 'Signature algorithm: cosign|x509|pgp')
    .option('--server <url>', 'Server base URL', process.env.SERVER_BASE || 'http://localhost:3000')
    .action(async (opts: any) => {
      const logger = createLogger(program.opts().verbose);
      try {
        const res = await publishBundle(opts.bundle, opts.manifest, {
          declaredHash: opts.declaredHash,
          cacheControl: opts.cacheControl,
          signaturePath: opts.signature,
          signatureAlgorithm: opts.signatureAlgorithm,
          server: opts.server,
          adminHeader: process.env.ALGA_ADMIN_HEADER === 'true',
        });
        if (program.opts().json) console.log(JSON.stringify(res, null, 2));
        else logger.info(res);
      } catch (e) {
        logger.error((e as Error).message);
        process.exit(1);
      }
    });
}

