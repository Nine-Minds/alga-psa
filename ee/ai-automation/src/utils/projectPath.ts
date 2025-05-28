import * as path from 'path';
import * as fs from 'fs';

/**
 * Get the project root directory based on the environment
 * In development: process.cwd() is /tools/ai-automation, so go up 2 levels to alga-psa root
 * In test container: alga-psa codebase is copied to /usr/src/alga-psa
 */
export function getProjectRoot(): string {
  // Check if we're in a Docker container by looking for the copied alga-psa codebase
  const containerAlgaPsaPath = '/usr/src/alga-psa';
  
  if (fs.existsSync(containerAlgaPsaPath)) {
    console.log('\x1b[36m[PROJECT-PATH] 📁 Using container alga-psa path\x1b[0m', containerAlgaPsaPath);
    return containerAlgaPsaPath;
  }
  
  // Development environment - go up from tools/ai-automation to alga-psa project root
  const devPath = path.resolve(process.cwd(), '../..');
  console.log('\x1b[36m[PROJECT-PATH] 📁 Using development alga-psa path\x1b[0m', devPath);
  return devPath;
}

/**
 * Resolve a path relative to the project root and ensure it's within bounds
 */
export function resolveProjectPath(relativePath: string): string {
  const projectRoot = getProjectRoot();
  const resolvedPath = path.resolve(projectRoot, relativePath);
  
  if (!resolvedPath.startsWith(projectRoot)) {
    throw new Error('Access denied - path outside project directory');
  }
  
  return resolvedPath;
}