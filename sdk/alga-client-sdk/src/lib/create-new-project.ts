import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CreateNewProjectOptions {
  name: string;
  template?: 'basic' | 'ui-gallery';
  directory?: string; // target directory (defaults to cwd/name)
}

export async function createNewProject(options: CreateNewProjectOptions): Promise<void> {
  const { name, template = 'basic', directory } = options;
  if (!name || name.trim().length === 0) {
    throw new Error('Project name is required');
  }
  if (!['basic', 'ui-gallery'].includes(template)) {
    throw new Error(`Unknown template: ${template}`);
  }

  const targetDir = path.resolve(directory || process.cwd(), name);
  await ensureDir(targetDir);

  const thisFile = fileURLToPath(import.meta.url);
  const templateDir = path.resolve(path.dirname(thisFile), '..', '..', 'templates', template);
  await copyDir(templateDir, targetDir);

  // Replace __PACKAGE_NAME__ placeholders
  await replaceInFiles(targetDir, '__PACKAGE_NAME__', name);
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
    const p = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await replaceInFiles(p, from, to);
    } else if (entry.isFile()) {
      try {
        const buf = await fs.readFile(p);
        const text = buf.toString('utf8');
        const replaced = text.replaceAll(from, to);
        if (replaced !== text) {
          await fs.writeFile(p, replaced, 'utf8');
        }
      } catch {
        // ignore non-text files
      }
    }
  }
}
