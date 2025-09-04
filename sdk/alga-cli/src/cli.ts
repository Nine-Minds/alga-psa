#!/usr/bin/env node
import { createNewProject, packProject, sign as signBundle } from '@alga-psa/client-sdk';

function printHelp() {
  console.log(`
Alga CLI

Usage:
  alga create extension <name> [--template basic|ui-gallery] [--dir <path>]
  alga pack [options]         (coming soon)
  alga publish [options]      (coming soon)
  alga sign <bundlePath> --algorithm cosign|x509|pgp

Examples:
  alga create extension my-ext
  alga create extension my-ui --template ui-gallery --dir ./apps
`);
}

async function main(argv: string[]) {
  const args = argv.slice(2);
  const [cmd, sub, name, ...rest] = args;

  if (!cmd || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }

  if (cmd === 'create' && sub === 'extension') {
    if (!name) {
      console.error('Error: extension name is required');
      process.exitCode = 1;
      return;
    }

    // naive arg parsing for --template and --dir
    let template: 'basic' | 'ui-gallery' | undefined;
    let directory: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      const v = rest[i];
      if (v === '--template') {
        template = rest[i + 1] as any;
        i++;
      } else if (v === '--dir' || v === '--directory') {
        directory = rest[i + 1];
        i++;
      }
    }

    await createNewProject({ name, template, directory });
    console.log(`Created extension project: ${name}`);
    return;
  }

  // pack
  if (cmd === 'pack') {
    // parse: --project <path> --out <file> --force
    const rem = args.slice(1);
    let projectPath: string | undefined;
    let outFile: string | undefined;
    let force = false;
    for (let i = 0; i < rem.length; i++) {
      const v = rem[i];
      if (v === '--project' || v === '--dir' || v === '--cwd') {
        projectPath = rem[i + 1];
        i++;
      } else if (v === '--out' || v === '--outfile') {
        outFile = rem[i + 1];
        i++;
      } else if (v === '--force' || v === '-f') {
        force = true;
      }
    }
    const out = await packProject({ projectPath, outFile, force, logger: console });
    console.log(`Packed → ${out}`);
    return;
  }

  // sign
  if (cmd === 'sign') {
    const rem = args.slice(1);
    let bundlePath: string | undefined;
    let algorithm: 'cosign' | 'x509' | 'pgp' | undefined;
    for (let i = 0; i < rem.length; i++) {
      const v = rem[i];
      if (!v.startsWith('--') && !bundlePath) {
        bundlePath = v;
        continue;
      }
      if (v === '--algorithm' || v === '--alg') {
        algorithm = rem[i + 1] as any;
        i++;
      }
    }
    if (!bundlePath) {
      console.error('Error: bundlePath is required');
      process.exitCode = 1;
      return;
    }
    if (!algorithm || !['cosign', 'x509', 'pgp'].includes(algorithm)) {
      console.error('Error: --algorithm must be one of cosign|x509|pgp');
      process.exitCode = 1;
      return;
    }
    const res = await signBundle({ bundlePath, algorithm });
    console.log(`Signature written → ${res.signaturePath}`);
    return;
  }

  console.error('Unknown command');
  printHelp();
  process.exitCode = 1;
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main(process.argv);
