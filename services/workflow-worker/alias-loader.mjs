import { resolve as pathResolve } from 'path';
import { pathToFileURL } from 'url';
import { existsSync } from 'fs';

// Determine project root: two levels up from this loader file
const projectRoot = new URL('../..', import.meta.url).pathname;

const aliasMappings = {
  "@/": "server/src/",
  "@shared/": "shared/",
  "@server/": "server/src/",
  "@ee/": "services/workflow-worker/placeholder/"
};

export async function resolve(specifier, context, defaultResolve) {
  for (const [alias, target] of Object.entries(aliasMappings)) {
    if (specifier.startsWith(alias)) {
      let newSpecifier = specifier.replace(alias, target);
      // If newSpecifier already has an extension and it's .ts, try replacing it with .js if available
      if (newSpecifier.endsWith('.ts')) {
          newSpecifier = newSpecifier.slice(0, -3) + '.js';
      } else if (!/\.[^/]+$/.test(newSpecifier)) {
        // No extension present; try candidate files in order: .js, .ts, index.js, index.ts
        const candidateJs = newSpecifier + '.js';
        const candidateTs = newSpecifier + '.ts';
        const candidateIndexJs = newSpecifier + '/index.js';
        const candidateIndexTs = newSpecifier + '/index.ts';
        if (existsSync(pathResolve(projectRoot, candidateJs))) {
          newSpecifier = candidateJs;
        } else if (existsSync(pathResolve(projectRoot, candidateTs))) {
          newSpecifier = candidateTs;
        } else if (existsSync(pathResolve(projectRoot, candidateIndexJs))) {
          newSpecifier = candidateIndexJs;
        } else if (existsSync(pathResolve(projectRoot, candidateIndexTs))) {
          newSpecifier = candidateIndexTs;
        } else {
          newSpecifier = candidateJs; // default to .js
        }
      }
      const resolvedPath = pathToFileURL(pathResolve(projectRoot, newSpecifier)).href;
      return { url: resolvedPath, shortCircuit: true };
    }
  }
  return defaultResolve(specifier, context, defaultResolve);
}
