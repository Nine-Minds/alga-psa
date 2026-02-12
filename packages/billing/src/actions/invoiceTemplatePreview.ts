// @ts-nocheck
'use server'

import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'node:util';
import crypto from 'crypto';
import { withAuth } from '@alga-psa/auth';
import { v4 as uuidv4 } from 'uuid';
import type { WasmInvoiceViewModel } from '@alga-psa/types';
import {
  buildAssemblyScriptCompileCommand,
  resolveAssemblyScriptProjectDir,
} from '../lib/invoice-template-compiler/assemblyScriptCompile';
import type { DesignerWorkspaceSnapshot } from '../components/invoice-designer/state/designerStore';
import { exportWorkspaceToInvoiceTemplateAst } from '../components/invoice-designer/ast/workspaceAst';
import { evaluateInvoiceTemplateAst, InvoiceTemplateEvaluationError } from '../lib/invoice-template-ast/evaluator';
import { renderEvaluatedInvoiceTemplateAst } from '../lib/invoice-template-ast/react-renderer';
import { validateInvoiceTemplateAst } from '../lib/invoice-template-ast/schema';

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

const buildPreviewCompileCommand = (params: {
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

    const asmScriptProjectDir = resolveAssemblyScriptProjectDir();
    const assemblyDir = path.resolve(asmScriptProjectDir, 'assembly');
    const tempCompileDir = path.resolve(asmScriptProjectDir, 'temp_compile');
    const previewRootDir = path.resolve(tempCompileDir, 'preview');
    const previewDir = path.resolve(tempCompileDir, 'preview', sanitizeForPath(tenant));
    const previewAssemblyDir = path.resolve(previewRootDir, 'assembly');
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
      await fs.rm(previewAssemblyDir, { force: true, recursive: true });
      await fs.symlink(assemblyDir, tempAssemblyDir, 'dir');
      await fs.symlink(assemblyDir, previewAssemblyDir, 'dir');
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
};

export const compilePreviewAssemblyScript = withAuth(
  async (_user, { tenant }, input: PreviewCompileInput): Promise<PreviewCompileResult> =>
    compilePreviewAssemblyScriptForTenant(tenant, input)
);

type AuthoritativePreviewInput = {
  workspace: DesignerWorkspaceSnapshot;
  invoiceData: WasmInvoiceViewModel | null;
  tolerancePx?: number;
};

type AuthoritativePreviewDiagnostic = {
  kind: 'schema' | 'evaluation' | 'runtime';
  severity: 'error';
  message: string;
  raw: string;
  code?: string;
  path?: string;
  operationId?: string;
  nodeId?: string;
};

type AuthoritativePreviewResult = {
  success: boolean;
  sourceHash: string | null;
  generatedSource: string | null;
  compile: {
    status: 'idle' | 'success' | 'error';
    diagnostics: AuthoritativePreviewDiagnostic[];
    error?: string;
    details?: string;
  };
  render: {
    status: 'idle' | 'success' | 'error';
    html: string | null;
    css: string | null;
    contentHeightPx?: number | null;
    error?: string;
  };
  verification: {
    status: 'idle' | 'pass' | 'issues' | 'error';
    mismatches: Array<{ constraintId: string; expected: string; actual?: string; delta?: string }>;
    error?: string;
  };
};

export const runAuthoritativeInvoiceTemplatePreview = withAuth(
  async (_user, _context, input: AuthoritativePreviewInput): Promise<AuthoritativePreviewResult> => {
    if (!input?.workspace || !Array.isArray(input.workspace.nodes) || input.workspace.nodes.length === 0) {
      return {
        success: false,
        sourceHash: null,
        generatedSource: null,
        compile: {
          status: 'error',
          diagnostics: [],
          error: 'Preview workspace is empty.',
        },
        render: { status: 'idle', html: null, css: null, contentHeightPx: null },
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
          diagnostics: [],
        },
        render: { status: 'idle', html: null, css: null, contentHeightPx: null },
        verification: { status: 'idle', mismatches: [] },
      };
    }

    const ast = exportWorkspaceToInvoiceTemplateAst(input.workspace);
    const generatedSource = JSON.stringify(ast, null, 2);
    const sourceHash = crypto.createHash('sha256').update(generatedSource).digest('hex');

    const validation = validateInvoiceTemplateAst(ast);
    if (!validation.success) {
      return {
        success: false,
        sourceHash,
        generatedSource,
        compile: {
          status: 'error',
          diagnostics: validation.errors.map((error) => ({
            kind: 'schema',
            severity: 'error',
            message: `${error.path || '<root>'}: ${error.message}`,
            raw: `${error.code}:${error.path}:${error.message}`,
            code: error.code,
            path: error.path || undefined,
          })),
          error: 'AST validation failed.',
          details: validation.errors.map((error) => `${error.path || '<root>'}: ${error.message}`).join('; '),
        },
        render: { status: 'idle', html: null, css: null, contentHeightPx: null },
        verification: { status: 'idle', mismatches: [] },
      };
    }

    try {
      const evaluation = evaluateInvoiceTemplateAst(validation.ast, input.invoiceData as unknown as Record<string, unknown>);
      const rendered = renderEvaluatedInvoiceTemplateAst(validation.ast, evaluation);
      return {
        success: true,
        sourceHash,
        generatedSource,
        compile: {
          status: 'success',
          diagnostics: [],
        },
        render: {
          status: 'success',
          html: rendered.html,
          css: rendered.css,
          contentHeightPx: null,
        },
        verification: {
          status: 'pass',
          mismatches: [],
        },
      };
    } catch (error: any) {
      const isEvaluationError = error instanceof InvoiceTemplateEvaluationError;
      return {
        success: false,
        sourceHash,
        generatedSource,
        compile: {
          status: 'error',
          diagnostics: isEvaluationError
            ? error.issues.map((issue) => ({
                kind: 'evaluation',
                severity: 'error',
                message: issue.message,
                raw: `${issue.code}:${issue.path ?? ''}:${issue.message}`,
                code: issue.code,
                path: issue.path,
                operationId: issue.operationId,
              }))
            : [{
                kind: 'runtime',
                severity: 'error',
                message: error?.message || String(error),
                raw: String(error?.message || error),
              }],
          error: isEvaluationError ? error.message : 'Evaluation failed.',
          details: error?.message || String(error),
        },
        render: {
          status: 'idle',
          html: null,
          css: null,
          contentHeightPx: null,
        },
        verification: {
          status: 'idle',
          mismatches: [],
        },
      };
    }
  }
);
