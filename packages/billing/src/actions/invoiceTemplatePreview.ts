// @ts-nocheck
'use server'

import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'node:util';
import { withAuth } from '@alga-psa/auth';
import { v4 as uuidv4 } from 'uuid';
import {
  buildAssemblyScriptCompileCommand,
  resolveAssemblyScriptProjectDir,
} from '../lib/invoice-template-compiler/assemblyScriptCompile';

const execPromise = promisify(exec);

type PreviewCompileInput = {
  source: string;
  sourceHash: string;
};

type PreviewCompileSuccess = {
  success: true;
  wasmBinary: Buffer;
  compileCommand: string;
};

type PreviewCompileFailure = {
  success: false;
  error: string;
  details?: string;
  compileCommand?: string;
};

type PreviewCompileResult = PreviewCompileSuccess | PreviewCompileFailure;

const sanitizeForPath = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');

export const buildPreviewCompileCommand = (params: {
  tempCompileDir: string;
  sourceFilePath: string;
  wasmOutputPath: string;
}) =>
  buildAssemblyScriptCompileCommand({
    workingDirectory: params.tempCompileDir,
    sourceFilePath: params.sourceFilePath,
    outFilePath: params.wasmOutputPath,
    baseDir: params.tempCompileDir,
  });

export const compilePreviewAssemblyScript = withAuth(
  async (_user, { tenant }, input: PreviewCompileInput): Promise<PreviewCompileResult> => {
    if (!input?.source || input.source.trim().length === 0) {
      return {
        success: false,
        error: 'Preview compile requires non-empty source.',
      };
    }

    const asmScriptProjectDir = resolveAssemblyScriptProjectDir();
    const assemblyDir = path.resolve(asmScriptProjectDir, 'assembly');
    const tempCompileDir = path.resolve(asmScriptProjectDir, 'temp_compile');
    const previewDir = path.resolve(tempCompileDir, 'preview', sanitizeForPath(tenant));
    const fileToken = sanitizeForPath(input.sourceHash || uuidv4()).slice(0, 64) || uuidv4();
    const sourceFilePath = path.resolve(previewDir, `${fileToken}.ts`);
    const wasmOutputPath = path.resolve(previewDir, `${fileToken}.wasm`);
    const tempAssemblyDir = path.resolve(tempCompileDir, 'assembly');

    if (
      !sourceFilePath.startsWith(tempCompileDir) ||
      !wasmOutputPath.startsWith(tempCompileDir) ||
      !previewDir.startsWith(tempCompileDir)
    ) {
      return {
        success: false,
        error: 'Security violation: attempted path traversal attack.',
      };
    }

    const compileCommand = buildPreviewCompileCommand({
      tempCompileDir,
      sourceFilePath,
      wasmOutputPath,
    });

    try {
      await fs.access(assemblyDir);
      await fs.mkdir(previewDir, { recursive: true });
      await fs.rm(tempAssemblyDir, { force: true, recursive: true });
      await fs.symlink(assemblyDir, tempAssemblyDir, 'dir');
      await fs.writeFile(sourceFilePath, input.source);

      const { stderr } = await execPromise(compileCommand);
      if (stderr && stderr.trim().length > 0) {
        console.warn('[compilePreviewAssemblyScript] asc stderr:', stderr);
      }

      await fs.access(wasmOutputPath);
      const wasmBinary = await fs.readFile(wasmOutputPath);
      if (!wasmBinary || wasmBinary.length === 0) {
        throw new Error('Compiled WASM binary is empty.');
      }

      return {
        success: true,
        wasmBinary,
        compileCommand,
      };
    } catch (error: any) {
      return {
        success: false,
        error: 'Preview AssemblyScript compilation failed.',
        details: error?.stderr || error?.stdout || error?.message || String(error),
        compileCommand,
      };
    } finally {
      await Promise.all([
        fs.rm(sourceFilePath, { force: true }),
        fs.rm(wasmOutputPath, { force: true }),
      ]).catch(() => undefined);
    }
  }
);
