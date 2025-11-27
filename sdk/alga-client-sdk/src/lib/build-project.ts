import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

export interface BuildProjectOptions {
  /** Project root. Defaults to `process.cwd()` */
  projectPath?: string;
  /** Skip npm install if node_modules exists */
  skipInstall?: boolean;
  /** Logger for output */
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

export interface BuildProjectResult {
  success: boolean;
  wasmPath?: string;
  error?: string;
}

interface ManifestJson {
  name?: string;
  runtime?: string;
  api?: {
    endpoints?: Array<{ handler?: string }>;
  };
}

/**
 * Build an extension project.
 *
 * This handles the full build workflow:
 * 1. Install dependencies (if needed)
 * 2. Compile TypeScript to JavaScript
 * 3. Componentize JavaScript to WASM (if the extension has API handlers)
 *
 * The output WASM is placed at dist/main.wasm to match the runner's expectations.
 */
export async function buildProject(opts: BuildProjectOptions = {}): Promise<BuildProjectResult> {
  const log = opts.logger ?? console;
  const project = resolve(opts.projectPath || process.cwd());

  // Check for manifest.json
  const manifestPath = join(project, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return { success: false, error: `manifest.json not found in project: ${project}` };
  }

  let manifest: ManifestJson;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    return { success: false, error: `Failed to parse manifest.json: ${err}` };
  }

  // Determine if this is a WASM component project
  const hasApiEndpoints = manifest.api?.endpoints && manifest.api.endpoints.length > 0;
  const isWasmRuntime = manifest.runtime?.startsWith('wasm');
  const needsWasmBuild = hasApiEndpoints || isWasmRuntime;

  // Check for package.json
  const packageJsonPath = join(project, 'package.json');
  if (!existsSync(packageJsonPath)) {
    if (needsWasmBuild) {
      return { success: false, error: `package.json not found but WASM build is required` };
    }
    log.info('[build] No package.json found, skipping build (UI-only extension)');
    return { success: true };
  }

  // Install dependencies if needed
  const nodeModules = join(project, 'node_modules');
  if (!opts.skipInstall && !existsSync(nodeModules)) {
    log.info('[build] Installing dependencies...');
    const installResult = spawnSync('npm', ['install'], {
      cwd: project,
      stdio: 'inherit',
      shell: true,
    });
    if (installResult.status !== 0) {
      return { success: false, error: 'npm install failed' };
    }
  }

  // Check if there's a build script in package.json
  let packageJson: { scripts?: Record<string, string> };
  try {
    packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  } catch (err) {
    return { success: false, error: `Failed to parse package.json: ${err}` };
  }

  // If there's a custom build script, use it
  if (packageJson.scripts?.build) {
    log.info('[build] Running npm run build...');
    const buildResult = spawnSync('npm', ['run', 'build'], {
      cwd: project,
      stdio: 'inherit',
      shell: true,
    });
    if (buildResult.status !== 0) {
      return { success: false, error: 'npm run build failed' };
    }

    // Check for WASM output
    const wasmPath = join(project, 'dist', 'main.wasm');
    const componentWasmPath = join(project, 'dist', 'component.wasm');

    if (existsSync(wasmPath)) {
      log.info(`[build] WASM component built: dist/main.wasm`);
      return { success: true, wasmPath };
    } else if (existsSync(componentWasmPath)) {
      // Alias component.wasm to main.wasm for runner compatibility
      log.info('[build] Copying dist/component.wasm to dist/main.wasm for runner compatibility');
      const distDir = join(project, 'dist');
      mkdirSync(distDir, { recursive: true });
      const wasmContent = readFileSync(componentWasmPath);
      writeFileSync(wasmPath, wasmContent);
      return { success: true, wasmPath };
    } else if (needsWasmBuild) {
      return { success: false, error: 'Build completed but no WASM output found at dist/main.wasm or dist/component.wasm' };
    }

    return { success: true };
  }

  // No build script - try to run the default WASM build pipeline
  if (needsWasmBuild) {
    log.info('[build] No build script found, running default WASM build pipeline...');

    // Look for handler source
    const handlerPaths = [
      join(project, 'src', 'handler.ts'),
      join(project, 'src', 'index.ts'),
      join(project, 'handler.ts'),
    ];

    const handlerPath = handlerPaths.find(p => existsSync(p));
    if (!handlerPath) {
      return { success: false, error: 'No handler source found (src/handler.ts, src/index.ts, or handler.ts)' };
    }

    // Look for WIT file
    const witPaths = [
      join(project, 'wit', 'extension-runner.wit'),
      join(project, 'wit', 'ext.wit'),
    ];
    const witPath = witPaths.find(p => existsSync(p));
    if (!witPath) {
      return { success: false, error: 'No WIT file found (wit/extension-runner.wit or wit/ext.wit)' };
    }

    const distDir = join(project, 'dist');
    mkdirSync(distDir, { recursive: true });

    // Step 1: Compile TypeScript to JavaScript
    log.info('[build] Compiling TypeScript...');
    const tscResult = spawnSync('npx', ['tsc', '--outDir', join(distDir, 'js'), '--module', 'ESNext', '--moduleResolution', 'bundler', '--target', 'ESNext'], {
      cwd: project,
      stdio: 'inherit',
      shell: true,
    });

    // Try esbuild if tsc fails or isn't configured
    if (tscResult.status !== 0) {
      log.warn('[build] tsc failed, trying esbuild...');
      const esbuildResult = spawnSync('npx', [
        'esbuild',
        handlerPath,
        '--bundle',
        '--format=esm',
        '--platform=neutral',
        `--outfile=${join(distDir, 'js', 'handler.js')}`,
      ], {
        cwd: project,
        stdio: 'inherit',
        shell: true,
      });
      if (esbuildResult.status !== 0) {
        return { success: false, error: 'TypeScript compilation failed (both tsc and esbuild)' };
      }
    }

    // Find the compiled JS file
    const jsOutputPaths = [
      join(distDir, 'js', 'handler.js'),
      join(distDir, 'js', 'index.js'),
      join(distDir, 'js', 'src', 'handler.js'),
      join(distDir, 'js', 'src', 'index.js'),
    ];
    const jsPath = jsOutputPaths.find(p => existsSync(p));
    if (!jsPath) {
      return { success: false, error: 'TypeScript compiled but no JS output found' };
    }

    // Step 2: Componentize to WASM
    log.info('[build] Componentizing to WASM...');
    const wasmPath = join(distDir, 'main.wasm');
    const componentName = manifest.name?.replace(/[^a-zA-Z0-9-]/g, '-') || 'extension';

    const jcoResult = spawnSync('npx', [
      'jco', 'componentize',
      jsPath,
      '--wit', witPath,
      '--world', 'runner',
      '--out', wasmPath,
    ], {
      cwd: project,
      stdio: 'inherit',
      shell: true,
    });

    if (jcoResult.status !== 0) {
      return { success: false, error: 'WASM componentization failed (jco componentize)' };
    }

    if (!existsSync(wasmPath)) {
      return { success: false, error: 'jco componentize completed but no WASM output found' };
    }

    log.info(`[build] WASM component built: dist/main.wasm`);
    return { success: true, wasmPath };
  }

  log.info('[build] No WASM build required (UI-only extension)');
  return { success: true };
}
