import { describe, expect, test } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');

const readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

describe('extension scaffolding', () => {
  test('manifest.json contains required fields', () => {
    const manifest = readJson(path.join(root, 'manifest.json'));
    expect(manifest.name).toBeTruthy();
    expect(manifest.publisher).toBeTruthy();
    expect(manifest.version).toBeTruthy();
    expect(manifest.runtime).toBe('wasm-js@1');
  });

  test('manifest.json specifies iframe UI entry', () => {
    const manifest = readJson(path.join(root, 'manifest.json'));
    expect(manifest.ui?.type).toBe('iframe');
    expect(manifest.ui?.entry).toBe('ui/index.html');
  });

  test('manifest.json includes appMenu hook', () => {
    const manifest = readJson(path.join(root, 'manifest.json'));
    expect(manifest.ui?.hooks?.appMenu?.label).toBeTruthy();
  });

  test('package.json includes @alga/ui-kit dependency', () => {
    const pkg = readJson(path.join(root, 'package.json'));
    expect(pkg.dependencies?.['@alga/ui-kit']).toContain('file:../../../../packages/ui-kit');
  });

  test('package.json includes react and react-dom dependencies', () => {
    const pkg = readJson(path.join(root, 'package.json'));
    expect(pkg.dependencies?.react).toBeTruthy();
    expect(pkg.dependencies?.['react-dom']).toBeTruthy();
  });

  test('vite config outputs iframe bundle to ui/dist/iframe/main.js', () => {
    const viteConfig = fs.readFileSync(path.join(root, 'vite.iframe.config.ts'), 'utf8');
    expect(viteConfig).toContain("outDir: 'ui/dist/iframe'");
    expect(viteConfig).toContain("fileName: () => 'main.js'");
  });

  test('vite config aliases @alga/ui-kit', () => {
    const viteConfig = fs.readFileSync(path.join(root, 'vite.iframe.config.ts'), 'utf8');
    expect(viteConfig).toContain("'@alga/ui-kit'");
    expect(viteConfig).toContain("packages', 'ui-kit'");
  });

  test('index.html includes root div and loads main.js', () => {
    const html = fs.readFileSync(path.join(root, 'ui/index.html'), 'utf8');
    expect(html).toContain('id="root"');
    expect(html).toContain('./dist/iframe/main.js');
  });
});
