// @ts-nocheck
'use server'

import crypto from 'crypto';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { WasmInvoiceViewModel } from '@alga-psa/types';
import type { DesignerWorkspaceSnapshot } from '../components/invoice-designer/state/designerStore';
import { exportWorkspaceToTemplateAst } from '../components/invoice-designer/ast/workspaceAst';
import { evaluateTemplateAst, TemplateEvaluationError } from '../lib/invoice-template-ast/evaluator';
import { INVOICE_TEMPLATE_BINDING_ALIASES } from '../lib/invoice-template-ast/bindingAliases';
import { renderEvaluatedTemplateAst } from '../lib/invoice-template-ast/react-renderer';
import { validateTemplateAst } from '../lib/invoice-template-ast/schema';

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

function previewFailureResult(message: string, details?: string): AuthoritativePreviewResult {
  return {
    success: false,
    sourceHash: null,
    generatedSource: null,
    compile: {
      status: 'error',
      diagnostics: [
        {
          kind: 'runtime',
          severity: 'error',
          message,
          raw: message,
        },
      ],
      error: message,
      details,
    },
    render: { status: 'idle', html: null, css: null, contentHeightPx: null },
    verification: { status: 'idle', mismatches: [] },
  };
}

export const runAuthoritativeInvoiceTemplatePreview = withAuth(
  async (user, _context, input: AuthoritativePreviewInput): Promise<AuthoritativePreviewResult> => {
    if (!await hasPermission(user, 'billing', 'read')) {
      return previewFailureResult('Permission denied: billing read required');
    }

    const hasWorkspaceNodes =
      Boolean(input?.workspace?.nodesById) &&
      typeof input.workspace.nodesById === 'object' &&
      Object.keys(input.workspace.nodesById).length > 0;

    if (!hasWorkspaceNodes) {
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

    const ast = exportWorkspaceToTemplateAst(input.workspace);
    const generatedSource = JSON.stringify(ast, null, 2);
    const sourceHash = crypto.createHash('sha256').update(generatedSource).digest('hex');

    const validation = validateTemplateAst(ast);
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
      const evaluation = evaluateTemplateAst(
        validation.ast,
        input.invoiceData as unknown as Record<string, unknown>,
        { bindingAliases: INVOICE_TEMPLATE_BINDING_ALIASES }
      );
      const rendered = await renderEvaluatedTemplateAst(validation.ast, evaluation);
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
      const isEvaluationError = error instanceof TemplateEvaluationError;
      const runtimeMessage = 'Template evaluation failed unexpectedly.';
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
            : [
                {
                  kind: 'runtime',
                  severity: 'error',
                  message: runtimeMessage,
                  raw: runtimeMessage,
                },
              ],
          error: isEvaluationError ? error.message : 'Evaluation failed.',
          details: isEvaluationError ? error.message : runtimeMessage,
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
