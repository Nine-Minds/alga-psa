import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CreateComponentProjectOptions {
  name: string;
  template?: 'component-basic';
  directory?: string;
}

const DEFAULT_TEMPLATE = 'component-basic';

export async function createComponentProject(options: CreateComponentProjectOptions): Promise<void> {
  const { name, template = DEFAULT_TEMPLATE, directory } = options;
  if (!name || name.trim().length === 0) {
    throw new Error('Project name is required');
  }
  if (template !== DEFAULT_TEMPLATE) {
    throw new Error(`Unknown component template: ${template}`);
  }

  const targetDir = path.resolve(directory || process.cwd(), name);
  await ensureDir(targetDir);

  const thisFile = fileURLToPath(import.meta.url);
  const templateDir = path.resolve(path.dirname(thisFile), '..', '..', 'templates', template);
  await copyDir(templateDir, targetDir);

  await replaceInFiles(targetDir, '__PACKAGE_NAME__', name);
  await ensureRuntimeDependency(targetDir);
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyDir(src: string, dest: string) {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      const real = await fs.readlink(srcPath);
      await fs.symlink(real, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function replaceInFiles(root: string, from: string, to: string) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await replaceInFiles(filePath, from, to);
    } else if (entry.isFile()) {
      try {
        const buf = await fs.readFile(filePath);
        const text = buf.toString('utf8');
        const replaced = text.replaceAll(from, to);
        if (replaced !== text) {
          await fs.writeFile(filePath, replaced, 'utf8');
        }
      } catch {
        // ignore binary files
      }
    }
  }
}

async function ensureRuntimeDependency(projectDir: string) {
  const pkgPath = path.join(projectDir, 'package.json');
  try {
    const pkgRaw = await fs.readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(pkgRaw);
    pkg.dependencies = pkg.dependencies ?? {};
    if (!pkg.dependencies['@alga/extension-runtime']) {
      pkg.dependencies['@alga/extension-runtime'] = '^0.1.0';
    }
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.warn(`[create-component-project] failed to update package.json: ${err}`);
  }
}
