#!/usr/bin/env node
import {
  createComponentProject,
  createNewProject,
  installExtension,
  uninstallExtension,
  publishExtension,
  packProject,
  sign as signBundle,
} from '@alga-psa/client-sdk';
import { spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

function printHelp() {
  console.log(`
Alga CLI

Usage:
  alga create extension <name> [--template basic|ui-gallery] [--dir <path>]
  alga create component <name> [--dir <path>] [--template component-basic]
  alga component create <name> [--dir <path>] [--template component-basic]
  alga extension publish <dir> [--api-key <key>] [--tenant <tenantId>] [--base-url <url>] [--no-install]
  alga extension install <registryId> --version <version> [--api-key <key>] [--tenant <tenantId>] [--base-url <url>]
  alga extension uninstall <registryId> [--api-key <key>] [--tenant <tenantId>] [--base-url <url>]
  alga pack [options]
  alga sign <bundlePath> --algorithm cosign|x509|pgp

Examples:
  alga create extension my-ext
  alga create extension my-ui --template ui-gallery --dir ./apps
  alga extension publish ./my-extension --api-key $ALGA_API_KEY --tenant $ALGA_TENANT_ID
  alga extension install awesome-extension --version 1.2.3 --api-key $ALGA_API_KEY --tenant $ALGA_TENANT_ID
  alga extension uninstall awesome-extension --api-key $ALGA_API_KEY --tenant $ALGA_TENANT_ID
  alga component create my-component --dir ./components
`);
}

export async function runCLI(argv: string[]) {
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

  if (cmd === 'extension' && sub === 'publish') {
    const projectPath = name;
    const rem = rest;
    if (!projectPath) {
      console.error('Error: extension directory is required');
      process.exitCode = 1;
      return;
    }

    let apiKeyArg: string | undefined;
    let tenantIdArg: string | undefined;
    let baseUrlArg: string | undefined;
    let timeoutMs: number | undefined;
    let install = true;
    let force = false;

    for (let i = 0; i < rem.length; i++) {
      const value = rem[i];
      if (!value) continue;
      switch (value) {
        case '--api-key':
        case '--apikey':
          apiKeyArg = rem[i + 1];
          i++;
          break;
        case '--tenant':
        case '--tenant-id':
          tenantIdArg = rem[i + 1];
          i++;
          break;
        case '--base-url':
        case '--url':
          baseUrlArg = rem[i + 1];
          i++;
          break;
        case '--timeout':
          timeoutMs = Number(rem[i + 1]);
          i++;
          break;
        case '--no-install':
          install = false;
          break;
        case '--force':
        case '-f':
          force = true;
          break;
        default:
          break;
      }
    }

    const apiKey = apiKeyArg ?? process.env.ALGA_API_KEY;
    if (!apiKey) {
      console.error('Error: --api-key is required (or set ALGA_API_KEY)');
      process.exitCode = 1;
      return;
    }

    const tenantId = tenantIdArg ?? process.env.ALGA_TENANT_ID ?? process.env.ALGA_TENANT;
    if (!tenantId) {
      console.error('Error: --tenant is required (or set ALGA_TENANT_ID)');
      process.exitCode = 1;
      return;
    }

    const baseUrl = baseUrlArg ?? process.env.ALGA_API_BASE_URL;

    try {
      const result = await publishExtension({
        projectPath,
        apiKey,
        tenantId,
        baseUrl,
        install,
        force,
        timeoutMs,
        logger: console,
      });

      if (!result.success) {
        console.error('[extension publish] failed:', result.error);
        process.exitCode = 1;
        return;
      }

      console.log('[extension publish] success!', {
        registryId: result.registryId,
        versionId: result.versionId,
        contentHash: result.contentHash,
        installId: result.installId,
      });
    } catch (error: any) {
      console.error('[extension publish] error', error?.message ?? error);
      process.exitCode = 1;
    }
    return;
  }

  if (cmd === 'extension' && sub === 'install') {
    const registryId = name;
    const rem = rest;
    if (!registryId) {
      console.error('Error: registryId is required');
      process.exitCode = 1;
      return;
    }

    let version: string | undefined;
    let apiKeyArg: string | undefined;
    let tenantIdArg: string | undefined;
    let baseUrlArg: string | undefined;
    let timeoutMs: number | undefined;

    for (let i = 0; i < rem.length; i++) {
      const value = rem[i];
      if (!value) continue;
      switch (value) {
        case '--version':
        case '-v':
          version = rem[i + 1];
          i++;
          break;
        case '--api-key':
        case '--apikey':
          apiKeyArg = rem[i + 1];
          i++;
          break;
        case '--tenant':
        case '--tenant-id':
          tenantIdArg = rem[i + 1];
          i++;
          break;
        case '--base-url':
        case '--url':
          baseUrlArg = rem[i + 1];
          i++;
          break;
        case '--timeout':
          timeoutMs = Number(rem[i + 1]);
          i++;
          break;
        default:
          break;
      }
    }

    const versionValue = version ?? process.env.ALGA_EXTENSION_VERSION;
    if (!versionValue) {
      console.error('Error: --version is required (or set ALGA_EXTENSION_VERSION)');
      process.exitCode = 1;
      return;
    }

    const apiKey = apiKeyArg ?? process.env.ALGA_API_KEY;
    if (!apiKey) {
      console.error('Error: --api-key is required (or set ALGA_API_KEY)');
      process.exitCode = 1;
      return;
    }

    const tenantId = tenantIdArg ?? process.env.ALGA_TENANT_ID ?? process.env.ALGA_TENANT;
    if (!tenantId) {
      console.error('Error: --tenant is required (or set ALGA_TENANT_ID)');
      process.exitCode = 1;
      return;
    }

    const baseUrl = baseUrlArg ?? process.env.ALGA_API_BASE_URL;

    try {
      const result = await installExtension({
        registryId,
        version: versionValue,
        apiKey,
        tenantId,
        baseUrl,
        timeoutMs,
      });

      if (!result.success) {
        console.error('[extension install] failed', {
          status: result.status,
          message: result.message,
          details: result.raw,
        });
        process.exitCode = 1;
        return;
      }

      console.log('[extension install] enqueued', {
        registryId,
        version: versionValue,
        installId: result.installId ?? undefined,
        message: result.message,
      });
    } catch (error: any) {
      console.error('[extension install] error', error?.message ?? error);
      process.exitCode = 1;
    }
    return;
  }

  if (cmd === 'extension' && sub === 'uninstall') {
    const registryId = name;
    const rem = rest;
    if (!registryId) {
      console.error('Error: registryId is required');
      process.exitCode = 1;
      return;
    }

    let apiKeyArg: string | undefined;
    let tenantIdArg: string | undefined;
    let baseUrlArg: string | undefined;
    let timeoutMs: number | undefined;

    for (let i = 0; i < rem.length; i++) {
      const value = rem[i];
      if (!value) continue;
      switch (value) {
        case '--api-key':
        case '--apikey':
          apiKeyArg = rem[i + 1];
          i++;
          break;
        case '--tenant':
        case '--tenant-id':
          tenantIdArg = rem[i + 1];
          i++;
          break;
        case '--base-url':
        case '--url':
          baseUrlArg = rem[i + 1];
          i++;
          break;
        case '--timeout':
          timeoutMs = Number(rem[i + 1]);
          i++;
          break;
        default:
          break;
      }
    }

    const apiKey = apiKeyArg ?? process.env.ALGA_API_KEY;
    if (!apiKey) {
      console.error('Error: --api-key is required (or set ALGA_API_KEY)');
      process.exitCode = 1;
      return;
    }

    const tenantId = tenantIdArg ?? process.env.ALGA_TENANT_ID ?? process.env.ALGA_TENANT;
    if (!tenantId) {
      console.error('Error: --tenant is required (or set ALGA_TENANT_ID)');
      process.exitCode = 1;
      return;
    }

    const baseUrl = baseUrlArg ?? process.env.ALGA_API_BASE_URL;

    try {
      const result = await uninstallExtension({
        registryId,
        apiKey,
        tenantId,
        baseUrl,
        timeoutMs,
      });

      if (!result.success) {
        console.error('[extension uninstall] failed', {
          status: result.status,
          message: result.message,
          details: result.raw,
        });
        process.exitCode = 1;
        return;
      }

      console.log('[extension uninstall] success', {
        registryId,
        message: result.message,
      });
    } catch (error: any) {
      console.error('[extension uninstall] error', error?.message ?? error);
      process.exitCode = 1;
    }
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

const maybeMain = process.argv[1];
if (maybeMain) {
  const entryHref = pathToFileURL(maybeMain).href;
  if (entryHref === import.meta.url) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    runCLI(process.argv);
  }
}

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
