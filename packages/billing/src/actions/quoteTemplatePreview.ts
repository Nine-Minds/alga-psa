// @ts-nocheck
'use server'

import crypto from 'crypto';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { QuoteViewModel } from '@alga-psa/types';
import type { DesignerWorkspaceSnapshot } from '../components/invoice-designer/state/designerStore';
import { exportWorkspaceToTemplateAst } from '../components/invoice-designer/ast/workspaceAst';
import { evaluateTemplateAst, TemplateEvaluationError } from '../lib/invoice-template-ast/evaluator';
import { localizeTemplateAstForLocale } from '../lib/invoice-template-ast/i18nLabels';
import { renderEvaluatedTemplateAst } from '../lib/invoice-template-ast/react-renderer';
import { buildTemplateHtmlDocument, inlinePreviewDocumentImages } from '../lib/invoice-template-ast/server-render';
import { validateTemplateAst } from '../lib/invoice-template-ast/schema';
import { createPDFGenerationService } from '../services/pdfGenerationService';

type AuthoritativePreviewInput = {
  workspace: DesignerWorkspaceSnapshot;
  quoteData: QuoteViewModel | null;
  tolerancePx?: number;
  /** Preview the document as a client in this locale would receive it. */
  locale?: string;
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
    /** The same render as a full HTML document, drawn as the pages it prints as. */
    documentHtml?: string | null;
    contentHeightPx?: number | null;
    error?: string;
  };
  verification: {
    status: 'idle' | 'pass' | 'issues' | 'error';
    mismatches: Array<{ constraintId: string; expected: string; actual?: string; delta?: string }>;
    error?: string;
  };
};

export const runAuthoritativeQuoteTemplatePreview = withAuth(
  async (user, { tenant }, input: AuthoritativePreviewInput): Promise<AuthoritativePreviewResult> => {
    if (!await hasPermission(user, 'billing', 'read')) {
      return {
        success: false,
        sourceHash: null,
        generatedSource: null,
        compile: {
          status: 'error',
          diagnostics: [],
          error: 'Permission denied: billing read required',
        },
        render: { status: 'idle', html: null, css: null, contentHeightPx: null },
        verification: { status: 'idle', mismatches: [] },
      };
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

    if (!input.quoteData) {
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
      const evaluation = evaluateTemplateAst(validation.ast, input.quoteData as unknown as Record<string, unknown>);
      // Same seam the PDF path uses, so the preview is authoritative. There is
      // no concrete quote here, so the country is the tenant's default.
      const localized = await localizeTemplateAstForLocale(validation.ast, input.locale);
      const dateFormat = await createPDFGenerationService(tenant).resolveRenderCountry({});
      const rendered = await renderEvaluatedTemplateAst(localized.ast, evaluation, {
        locale: localized.locale,
        dateFormat,
        t: localized.t,
      });
      // The author sees the pages this quote prints as, chunked by the same engine that prints them.
      // Its images are inlined first (inlinePreviewDocumentImages), or the chunker would
      // measure a header the author's iframe then draws taller.
      const { paginateDocumentPreviewHtml } = await import('../lib/invoice-template-ast/previewPagination.server');
      const paginated = await paginateDocumentPreviewHtml(
        await inlinePreviewDocumentImages(
          buildTemplateHtmlDocument(validation.ast, { ...rendered, locale: localized.locale }, { title: 'Quote preview' }),
        ),
        validation.ast,
      );
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
          documentHtml: paginated.html,
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
