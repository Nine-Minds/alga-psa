#!/usr/bin/env node
import { createComponentProject, createNewProject, packProject, sign as signBundle } from '@alga-psa/client-sdk';
import { spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { resolve, join } from 'node:path';

function printHelp() {
  console.log(`
Alga CLI

Usage:
  alga create extension <name> [--template basic|ui-gallery] [--dir <path>]
  alga create component <name> [--dir <path>] [--template component-basic]
  alga component create <name> [--dir <path>] [--template component-basic]
  alga pack [options]         (coming soon)
  alga publish [options]      (coming soon)
  alga sign <bundlePath> --algorithm cosign|x509|pgp

Examples:
  alga create extension my-ext
  alga create extension my-ui --template ui-gallery --dir ./apps
  alga component create my-component --dir ./components
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

  if ((cmd === 'create' && sub === 'component') || (cmd === 'component' && sub === 'create')) {
    const projectName = cmd === 'create' ? name : sub === 'create' ? name : undefined;
    const argOffset = cmd === 'create' ? rest : args.slice(3);
    if (!projectName) {
      console.error('Error: component name is required');
      process.exitCode = 1;
      return;
    }

    let template: 'component-basic' | undefined;
    let directory: string | undefined;
    for (let i = 0; i < argOffset.length; i++) {
      const value = argOffset[i];
      if (value === '--template') {
        template = argOffset[i + 1] as any;
        i++;
      } else if (value === '--dir' || value === '--directory') {
        directory = argOffset[i + 1];
        i++;
      }
    }

    await createComponentProject({ name: projectName, template, directory });
    console.log(`Created component project: ${projectName}`);
    return;
  }

  if ((cmd === 'component' && sub === 'dev') || (cmd === 'dev' && sub === 'component')) {
    const argOffset = cmd === 'component' ? [name, ...rest] : args.slice(2);
    let targetDir: string | undefined;
    let projectName: string | undefined = cmd === 'component' ? rest[0] : name;
    for (let i = 0; i < argOffset.length; i++) {
      const value = argOffset[i];
      if (!value) continue;
      if (value === '--dir' || value === '--directory') {
        targetDir = argOffset[i + 1];
        i++;
      } else if (!value.startsWith('--') && !projectName) {
        projectName = value;
      }
    }

    const projectPath = resolve(targetDir ?? (projectName ? projectName : '.'));
    runComponentDev(projectPath);
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

function runComponentDev(projectDir: string) {
  const normalized = resolve(projectDir);
  console.log(`[component dev] watching ${normalized}`);

  let building = false;
  let pending = false;
  const triggerBuild = () => {
    if (building) {
      pending = true;
      return;
    }
    building = true;
    const child = spawn('npm', ['run', 'build'], {
      cwd: normalized,
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      building = false;
      if (code === 0) {
        console.log('[component dev] build complete');
      } else {
        console.error(`[component dev] build failed with code ${code}`);
      }
      if (pending) {
        pending = false;
        triggerBuild();
      }
    });
  };

  const watchTargets = [
    join(normalized, 'src'),
    join(normalized, 'wit'),
    join(normalized, 'manifest.json'),
  ];

  const startWatch = (target: string) => {
    if (!existsSync(target)) return;
    try {
      const watcher = watch(target, { recursive: !target.endsWith('.json') }, () => {
        pending = false;
        triggerBuild();
      });
      process.on('SIGINT', () => watcher.close());
    } catch (err) {
      console.warn(`[component dev] failed to watch ${target}: ${err}`);
    }
  };

  triggerBuild();
  for (const target of watchTargets) {
    startWatch(target);
  }
  console.log('[component dev] watching for changes (Ctrl+C to exit)…');
}
