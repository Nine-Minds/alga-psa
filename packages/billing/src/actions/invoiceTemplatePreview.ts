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
  cacheHit: boolean;
};

type PreviewCompileFailure = {
  success: false;
  error: string;
  details?: string;
  compileCommand?: string;
};

type PreviewCompileResult = PreviewCompileSuccess | PreviewCompileFailure;

const sanitizeForPath = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');
const PREVIEW_COMPILE_CACHE_LIMIT = 32;

type PreviewCompileCacheEntry = {
  wasmBinary: Buffer;
  compileCommand: string;
};

const previewCompileCache = new Map<string, PreviewCompileCacheEntry>();

const resolveCacheKey = (input: PreviewCompileInput): string => {
  const normalizedHash = sanitizeForPath(input.sourceHash || '').slice(0, 96);
  if (normalizedHash.length > 0) {
    return normalizedHash;
  }
  return `inline_${sanitizeForPath(input.source).slice(0, 96)}`;
};

const getCachedPreviewCompileArtifact = (cacheKey: string): PreviewCompileCacheEntry | null => {
  const existing = previewCompileCache.get(cacheKey);
  if (!existing) {
    return null;
  }

  // Maintain LRU ordering by reinserting hits.
  previewCompileCache.delete(cacheKey);
  previewCompileCache.set(cacheKey, existing);
  return existing;
};

const setCachedPreviewCompileArtifact = (cacheKey: string, value: PreviewCompileCacheEntry) => {
  previewCompileCache.set(cacheKey, value);
  while (previewCompileCache.size > PREVIEW_COMPILE_CACHE_LIMIT) {
    const oldestKey = previewCompileCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    previewCompileCache.delete(oldestKey);
  }
};

export const __previewCompileCacheTestUtils = {
  clear: () => previewCompileCache.clear(),
  size: () => previewCompileCache.size,
  get: (key: string) => previewCompileCache.get(key) ?? null,
  set: (key: string, value: PreviewCompileCacheEntry) => setCachedPreviewCompileArtifact(key, value),
};

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

    const cacheKey = resolveCacheKey(input);

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

    const cached = getCachedPreviewCompileArtifact(cacheKey);
    if (cached) {
      return {
        success: true,
        wasmBinary: cached.wasmBinary,
        compileCommand: cached.compileCommand,
        cacheHit: true,
      };
    }

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
      setCachedPreviewCompileArtifact(cacheKey, { wasmBinary, compileCommand });

      return {
        success: true,
        wasmBinary,
        compileCommand,
        cacheHit: false,
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
