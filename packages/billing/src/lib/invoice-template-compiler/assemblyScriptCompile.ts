import { existsSync } from 'node:fs';
import path from 'node:path';

export const ASSEMBLYSCRIPT_SHARED_COMPILE_FLAGS = [
  '--runtime stub',
  '--debug',
  '--exportRuntime',
  '--transform json-as/transform',
  '--sourceMap',
] as const;

export const quoteShellPath = (value: string): string => `"${value.replace(/(["\\$`])/g, '\\$1')}"`;

export const resolveAssemblyScriptProjectDir = (cwd = process.cwd()): string => {
  const modernPath = path.resolve(cwd, 'server/src/invoice-templates/assemblyscript');
  if (existsSync(modernPath)) {
    return modernPath;
  }

  return path.resolve(cwd, 'src/invoice-templates/assemblyscript');
};

export const buildAssemblyScriptCompileCommand = (params: {
  workingDirectory: string;
  sourceFilePath: string;
  outFilePath: string;
  baseDir: string;
}) => {
  const flags = ASSEMBLYSCRIPT_SHARED_COMPILE_FLAGS.join(' ');
  return `cd ${quoteShellPath(params.workingDirectory)} && npx asc ${quoteShellPath(
    params.sourceFilePath
  )} --outFile ${quoteShellPath(params.outFilePath)} ${flags} --baseDir ${quoteShellPath(params.baseDir)}`;
};
