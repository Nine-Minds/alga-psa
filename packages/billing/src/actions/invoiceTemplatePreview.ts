// @ts-nocheck
'use server'

import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'node:util';
import { withAuth } from '@alga-psa/auth';
import { v4 as uuidv4 } from 'uuid';
import type { WasmInvoiceViewModel } from '@alga-psa/types';
import {
  buildAssemblyScriptCompileCommand,
  resolveAssemblyScriptProjectDir,
} from '../lib/invoice-template-compiler/assemblyScriptCompile';
import type { DesignerWorkspaceSnapshot } from '../components/invoice-designer/state/designerStore';
import { extractInvoiceDesignerIr } from '../components/invoice-designer/compiler/guiIr';
import { generateAssemblyScriptFromIr } from '../components/invoice-designer/compiler/assemblyScriptGenerator';
import {
  linkDiagnosticsToGuiNodes,
  parseAssemblyScriptDiagnostics,
} from '../components/invoice-designer/compiler/diagnostics';
import { executeWasmTemplate } from '../lib/invoice-renderer/wasm-executor';
import { renderLayout } from '../lib/invoice-renderer/layout-renderer';
import {
  collectRenderedGeometryFromLayout,
  compareLayoutConstraints,
  extractExpectedLayoutConstraintsFromIr,
} from '../lib/invoice-template-compiler/layoutVerification';

const execPromise = promisify(exec);

type PreviewCompileInput = {
  source: string;
  sourceHash: string;
  bypassCache?: boolean;
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

const compilePreviewAssemblyScriptForTenant = async (
  tenant: string,
  input: PreviewCompileInput
): Promise<PreviewCompileResult> => {
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
    if (cached && !input.bypassCache) {
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
};

export const compilePreviewAssemblyScript = withAuth(
  async (_user, { tenant }, input: PreviewCompileInput): Promise<PreviewCompileResult> =>
    compilePreviewAssemblyScriptForTenant(tenant, input)
);

type AuthoritativePreviewInput = {
  workspace: DesignerWorkspaceSnapshot;
  invoiceData: WasmInvoiceViewModel | null;
  bypassCompileCache?: boolean;
  tolerancePx?: number;
};

type AuthoritativePreviewResult = {
  success: boolean;
  sourceHash: string | null;
  generatedSource: string | null;
  compile: {
    status: 'idle' | 'success' | 'error';
    cacheHit: boolean;
    diagnostics: ReturnType<typeof linkDiagnosticsToGuiNodes>;
    error?: string;
    details?: string;
  };
  render: {
    status: 'idle' | 'success' | 'error';
    html: string | null;
    css: string | null;
    error?: string;
  };
  verification: {
    status: 'idle' | 'pass' | 'issues' | 'error';
    mismatches: ReturnType<typeof compareLayoutConstraints>['mismatches'];
    error?: string;
  };
};

export const runAuthoritativeInvoiceTemplatePreview = withAuth(
  async (_user, { tenant }, input: AuthoritativePreviewInput): Promise<AuthoritativePreviewResult> => {
    if (!input?.workspace || !Array.isArray(input.workspace.nodes) || input.workspace.nodes.length === 0) {
      return {
        success: false,
        sourceHash: null,
        generatedSource: null,
        compile: {
          status: 'error',
          cacheHit: false,
          diagnostics: [],
          error: 'Preview workspace is empty.',
        },
        render: { status: 'idle', html: null, css: null },
        verification: { status: 'idle', mismatches: [] },
      };
    }

    if (!input.invoiceData) {
      return {
        success: false,
        sourceHash: null,
        generatedSource: null,
        compile: {
          status: 'idle',
          cacheHit: false,
          diagnostics: [],
        },
        render: { status: 'idle', html: null, css: null },
        verification: { status: 'idle', mismatches: [] },
      };
    }

    const ir = extractInvoiceDesignerIr(input.workspace);
    const generated = generateAssemblyScriptFromIr(ir);
    const compileResult = await compilePreviewAssemblyScriptForTenant(tenant, {
      source: generated.source,
      sourceHash: generated.sourceHash,
      bypassCache: input.bypassCompileCache,
    });

    if (!compileResult.success) {
      const parsedDiagnostics = parseAssemblyScriptDiagnostics(compileResult.details ?? compileResult.error);
      const linkedDiagnostics = linkDiagnosticsToGuiNodes(parsedDiagnostics, generated.sourceMap);
      return {
        success: false,
        sourceHash: generated.sourceHash,
        generatedSource: generated.source,
        compile: {
          status: 'error',
          cacheHit: false,
          diagnostics: linkedDiagnostics,
          error: compileResult.error,
          details: compileResult.details,
        },
        render: { status: 'idle', html: null, css: null },
        verification: { status: 'idle', mismatches: [] },
      };
    }

    try {
      const renderedLayout = await executeWasmTemplate(input.invoiceData, compileResult.wasmBinary);
      const renderedOutput = renderLayout(renderedLayout);
      try {
        const expectedConstraints = extractExpectedLayoutConstraintsFromIr(ir, input.tolerancePx ?? 2);
        const renderedGeometry = collectRenderedGeometryFromLayout(renderedLayout);
        const verification = compareLayoutConstraints(expectedConstraints, renderedGeometry);
        return {
          success: true,
          sourceHash: generated.sourceHash,
          generatedSource: generated.source,
          compile: {
            status: 'success',
            cacheHit: compileResult.cacheHit,
            diagnostics: [],
          },
          render: {
            status: 'success',
            html: renderedOutput.html,
            css: renderedOutput.css,
          },
          verification: {
            status: verification.status,
            mismatches: verification.mismatches,
          },
        };
      } catch (verificationError: any) {
        return {
          success: false,
          sourceHash: generated.sourceHash,
          generatedSource: generated.source,
          compile: {
            status: 'success',
            cacheHit: compileResult.cacheHit,
            diagnostics: [],
          },
          render: {
            status: 'success',
            html: renderedOutput.html,
            css: renderedOutput.css,
          },
          verification: {
            status: 'error',
            mismatches: [],
            error: verificationError?.message || String(verificationError),
          },
        };
      }
    } catch (renderError: any) {
      return {
        success: false,
        sourceHash: generated.sourceHash,
        generatedSource: generated.source,
        compile: {
          status: 'success',
          cacheHit: compileResult.cacheHit,
          diagnostics: [],
        },
        render: {
          status: 'error',
          html: null,
          css: null,
          error: renderError?.message || String(renderError),
        },
        verification: {
          status: 'idle',
          mismatches: [],
        },
      };
    }
  }
);
