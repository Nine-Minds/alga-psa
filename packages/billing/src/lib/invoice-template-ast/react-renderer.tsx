import React from 'react';
import type {
  TemplateAst,
  TemplateNode,
  TemplateNodeStyleRef,
  TemplateStyleDeclaration,
  TemplateValueExpression,
  TemplateValueFormat,
} from '@alga-psa/types';
import type { TemplateEvaluationResult } from './evaluator';
import { decodeTemplatePathExpression } from './templateInterpolationFilters';
import { resolveTemplatePrintSettingsFromAst } from './printSettings';

type UnknownRecord = Record<string, unknown>;

type RenderScope = {
  row?: UnknownRecord;
};

type RenderContext = {
  locale: string;
  currencyCode: string;
};

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parsePxLength = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const numeric = Number.parseFloat(trimmed.replace(/px$/i, '').trim());
  return Number.isFinite(numeric) ? numeric : undefined;
};

const joinClassNames = (...values: Array<string | null | undefined | false>): string =>
  values.filter(Boolean).join(' ');

const sanitizeCssIdentifier = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, '-');

const toSafeCssIdentifier = (value: string): string | null => {
  const sanitized = sanitizeCssIdentifier(value);
  return sanitized.length > 0 ? sanitized : null;
};

const normalizeImageSrc = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  const lower = normalized.toLowerCase();
  if (lower === 'null' || lower === 'undefined') {
    return null;
  }
  return normalized;
};

const getPathValue = (target: unknown, path: string): unknown => {
  if (!path) {
    return target;
  }
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      return current[Number(segment)];
    }
    if (typeof current === 'object') {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, target);
};

const toCssValue = (value: string | number): string => (typeof value === 'number' ? String(value) : value);

const styleDeclarationToCss = (declaration: TemplateStyleDeclaration): string =>
  Object.entries(declaration)
    .map(([key, value]) => {
      const cssKey = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
      return `${cssKey}: ${toCssValue(value as string | number)};`;
    })
    .join(' ');

const styleDeclarationToReactStyle = (
  declaration?: TemplateStyleDeclaration
): React.CSSProperties | undefined => {
  if (!declaration) {
    return undefined;
  }
  return declaration as React.CSSProperties;
};

const resolveStyleRef = (
  styleRef?: TemplateNodeStyleRef
): { className: string | null; style?: React.CSSProperties } => {
  if (!styleRef) {
    return { className: null, style: undefined };
  }
  const className =
    styleRef.tokenIds && styleRef.tokenIds.length > 0
      ? styleRef.tokenIds
          .map((tokenId) => toSafeCssIdentifier(tokenId))
          .filter((tokenId): tokenId is string => Boolean(tokenId))
          .map((tokenId) => `ast-${tokenId}`)
          .join(' ')
      : null;
  return { className, style: styleDeclarationToReactStyle(styleRef.inline) };
};

const resolveSyntheticRootDocumentStyle = (ast: TemplateAst): React.CSSProperties | undefined => {
  if (ast.layout.type !== 'document' || !isRecord(ast.metadata?.printSettings)) {
    return undefined;
  }

  const documentInlineStyle = isRecord(ast.layout.style?.inline) ? ast.layout.style.inline : undefined;
  const documentPaddingPx = parsePxLength(documentInlineStyle?.padding);
  if (documentPaddingPx !== undefined && documentPaddingPx > 0) {
    return undefined;
  }

  const pageSectionCandidate =
    ast.layout.children.length === 1 && ast.layout.children[0]?.type === 'section'
      ? ast.layout.children[0]
      : null;
  const pageInlineStyle = isRecord(pageSectionCandidate?.style?.inline) ? pageSectionCandidate.style.inline : undefined;
  const pagePaddingPx = parsePxLength(pageInlineStyle?.padding);
  if (pagePaddingPx !== undefined && pagePaddingPx > 0) {
    return undefined;
  }

  const resolvedPrintSettings = resolveTemplatePrintSettingsFromAst(ast);
  if (resolvedPrintSettings.marginPx <= 0) {
    return undefined;
  }

  return {
    padding: `${resolvedPrintSettings.marginPx}px`,
    boxSizing: 'border-box',
  };
};

const formatValue = (value: unknown, format: TemplateValueFormat | undefined, ctx: RenderContext): string => {
  if (value === null || value === undefined) {
    return '';
  }

  const normalizedFormat: TemplateValueFormat = format ?? 'text';

  if (normalizedFormat === 'date') {
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
      return String(value);
    }
    return parsed.toLocaleDateString(ctx.locale);
  }

  if (normalizedFormat === 'currency') {
    const numeric = typeof value === 'number' ? value : Number(String(value));
    if (!Number.isFinite(numeric)) {
      return String(value);
    }
    try {
      return new Intl.NumberFormat(ctx.locale, {
        style: 'currency',
        currency: ctx.currencyCode || 'USD',
      }).format(numeric / 100);
    } catch {
      return `$${(numeric / 100).toFixed(2)}`;
    }
  }

  if (normalizedFormat === 'number') {
    const numeric = typeof value === 'number' ? value : Number(String(value));
    return Number.isFinite(numeric) ? String(numeric) : String(value);
  }

  return String(value);
};

const buildAstCss = (ast: TemplateAst): string => {
  const baseCss = `
.invoice-template-root {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.35;
  color: #111827;
}

.invoice-template-root section { margin: 0 0 16px; }
.invoice-template-root h2 { margin: 0 0 8px; font-size: 18px; font-weight: 700; }
.invoice-template-root p { margin: 0; }

.invoice-template-root table {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0 16px;
}
.invoice-template-root thead th {
  border-bottom: 1px solid #e5e7eb;
  font-weight: 600;
  text-align: left;
  padding: 6px 8px;
}
.invoice-template-root tbody td {
  padding: 6px 8px;
  vertical-align: top;
}
.invoice-template-root tbody tr + tr td { border-top: 1px solid #f3f4f6; }

.invoice-template-root .ast-node-type-field {
  display: flex;
  gap: 6px;
}

.invoice-template-root .ast-node-type-totals > .ast-totals-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 2px 0;
}
.invoice-template-root .ast-totals-value {
  text-align: right;
  white-space: nowrap;
}
`.trim();

  const classRules = Object.entries(ast.styles?.classes ?? {})
    .map(([className, declaration]) => {
      const safeClassName = toSafeCssIdentifier(className);
      if (!safeClassName) return '';
      return `.ast-${safeClassName} { ${styleDeclarationToCss(declaration)} }`;
    })
    .filter(Boolean)
    .join('\n');

  const tokenRules = Object.values(ast.styles?.tokens ?? {})
    .map((token) => {
      const safeTokenId = toSafeCssIdentifier(token.id);
      if (!safeTokenId) return '';
      return `--${safeTokenId}: ${toCssValue(token.value)};`;
    })
    .filter(Boolean)
    .join(' ');

  const rootRule = tokenRules.length > 0 ? `.invoice-template-root { ${tokenRules} }\n` : '';
  return `${baseCss}\n${rootRule}${classRules}`.trim();
};

const resolveExpressionValue = (
  expression: TemplateValueExpression,
  evaluation: TemplateEvaluationResult,
  scope: RenderScope,
  ctx: RenderContext
): unknown => {
  switch (expression.type) {
    case 'literal':
      return expression.value;
    case 'binding':
      return evaluation.bindings[expression.bindingId];
    case 'path': {
      const parsedPath = decodeTemplatePathExpression(expression.path);
      const rowValue = scope.row ? getPathValue(scope.row, parsedPath.path) : undefined;
      const resolvedValue =
        rowValue !== undefined
          ? rowValue
          : getPathValue(evaluation.bindings.invoice, parsedPath.path);

      if (resolvedValue === undefined) {
        return undefined;
      }

      if (parsedPath.filter === 'currency') {
        return formatValue(resolvedValue, 'currency', ctx);
      }

      return resolvedValue;
    }
    case 'template': {
      const args = expression.args ?? {};
      return expression.template.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g, (_match, name: string) => {
        const arg = args[name];
        if (arg) {
          const argValue = resolveExpressionValue(arg, evaluation, scope, ctx);
          return String(argValue ?? '');
        }
        if (scope.row) {
          const rowValue = getPathValue(scope.row, name);
          if (rowValue !== undefined) {
            return String(rowValue);
          }
        }
        const invoiceValue = getPathValue(evaluation.bindings.invoice, name);
        return String(invoiceValue ?? '');
      });
    }
    default:
      return '';
  }
};

const resolveCollection = (bindingId: string, evaluation: TemplateEvaluationResult): UnknownRecord[] => {
  const value = evaluation.bindings[bindingId];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord);
};

const renderNode = (
  node: TemplateNode,
  evaluation: TemplateEvaluationResult,
  scope: RenderScope,
  ctx: RenderContext,
  rootDocumentStyleOverride?: React.CSSProperties
): React.ReactNode => {
  const nodeTypeClass = `ast-node ast-node-type-${sanitizeCssIdentifier(node.type)}`;
  const { className: styleClassName, style } = resolveStyleRef(node.style);
  const elementClassName = joinClassNames(nodeTypeClass, styleClassName);

  switch (node.type) {
    case 'document':
      return (
        <div
          key={node.id}
          id={node.id}
          className={elementClassName || undefined}
          style={rootDocumentStyleOverride ? { ...(style ?? {}), ...rootDocumentStyleOverride } : style}
        >
          {node.children.map((child) => renderNode(child, evaluation, scope, ctx))}
        </div>
      );
    case 'section':
      return (
        <section key={node.id} id={node.id} className={elementClassName || undefined} style={style}>
          {node.title ? <h2>{node.title}</h2> : null}
          {node.children.map((child) => renderNode(child, evaluation, scope, ctx))}
        </section>
      );
    case 'stack': {
      const defaultStackStyle: React.CSSProperties = {
        display: 'flex',
        flexDirection: node.direction === 'row' ? 'row' : 'column',
        gap: '8px',
      };
      const mergedStyle: React.CSSProperties = { ...defaultStackStyle, ...(style ?? {}) };
      return (
        <div key={node.id} id={node.id} className={elementClassName || undefined} style={mergedStyle}>
          {node.children.map((child) => renderNode(child, evaluation, scope, ctx))}
        </div>
      );
    }
    case 'text': {
      const content = resolveExpressionValue(node.content, evaluation, scope, ctx);
      return (
        <p key={node.id} id={node.id} className={elementClassName || undefined} style={style}>
          {String(content ?? '')}
        </p>
      );
    }
    case 'field': {
      const value = evaluation.bindings[node.binding.bindingId];
      return (
        <div key={node.id} id={node.id} className={elementClassName || undefined} style={style}>
          {node.label ? <span>{node.label}: </span> : null}
          <span>{formatValue(value ?? node.emptyValue ?? '', node.format, ctx)}</span>
        </div>
      );
    }
    case 'image': {
      const src = normalizeImageSrc(resolveExpressionValue(node.src, evaluation, scope, ctx));
      if (!src) {
        return null;
      }
      const alt = node.alt ? resolveExpressionValue(node.alt, evaluation, scope, ctx) : '';
      return (
        <img
          key={node.id}
          id={node.id}
          className={elementClassName || undefined}
          style={style}
          src={src}
          alt={String(alt ?? '')}
        />
      );
    }
    case 'divider':
      return <hr key={node.id} id={node.id} className={elementClassName || undefined} style={style} />;
    case 'table': {
      const rows = resolveCollection(node.sourceBinding.bindingId, evaluation);
      return (
        <table key={node.id} id={node.id} className={elementClassName || undefined} style={style}>
          <thead>
            <tr>
              {node.columns.map((column) => {
                const { className: colClassName, style: colStyle } = resolveStyleRef(column.style);
                const alignRight = column.format === 'currency' || column.format === 'number';
                return (
                  <th
                    key={column.id}
                    className={colClassName || undefined}
                    style={{ ...(colStyle ?? {}), ...(alignRight ? { textAlign: 'right' } : {}) }}
                  >
                    {column.header ?? column.id}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={node.columns.length}>{node.emptyStateText ?? ''}</td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={`${node.id}-row-${index}`}>
                  {node.columns.map((column) => {
                    const value = resolveExpressionValue(column.value, evaluation, { row }, ctx);
                    const { className: colClassName, style: colStyle } = resolveStyleRef(column.style);
                    const alignRight = column.format === 'currency' || column.format === 'number';
                    return (
                      <td
                        key={column.id}
                        className={colClassName || undefined}
                        style={{ ...(colStyle ?? {}), ...(alignRight ? { textAlign: 'right' } : {}) }}
                      >
                        {formatValue(value ?? '', column.format, ctx)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      );
    }
    case 'dynamic-table': {
      const rows = resolveCollection(node.repeat.sourceBinding.bindingId, evaluation);
      return (
        <table key={node.id} id={node.id} className={elementClassName || undefined} style={style}>
          <thead>
            <tr>
              {node.columns.map((column) => {
                const { className: colClassName, style: colStyle } = resolveStyleRef(column.style);
                const alignRight = column.format === 'currency' || column.format === 'number';
                return (
                  <th
                    key={column.id}
                    className={colClassName || undefined}
                    style={{ ...(colStyle ?? {}), ...(alignRight ? { textAlign: 'right' } : {}) }}
                  >
                    {column.header ?? column.id}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={node.columns.length}>{node.emptyStateText ?? ''}</td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={`${node.id}-row-${index}`}>
                  {node.columns.map((column) => {
                    const value = resolveExpressionValue(column.value, evaluation, { row }, ctx);
                    const { className: colClassName, style: colStyle } = resolveStyleRef(column.style);
                    const alignRight = column.format === 'currency' || column.format === 'number';
                    return (
                      <td
                        key={column.id}
                        className={colClassName || undefined}
                        style={{ ...(colStyle ?? {}), ...(alignRight ? { textAlign: 'right' } : {}) }}
                      >
                        {formatValue(value ?? '', column.format, ctx)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      );
    }
    case 'totals': {
      const totalsBindingKey = `${node.sourceBinding.bindingId}.totals`;
      const totals = (evaluation.bindings[totalsBindingKey] ?? evaluation.totals) as Record<string, number>;
      return (
        <div key={node.id} id={node.id} className={elementClassName || undefined} style={style}>
          {node.rows.map((row) => {
            const raw = totals[row.id] ?? resolveExpressionValue(row.value, evaluation, scope, ctx) ?? '';
            return (
              <div key={row.id} className="ast-totals-row" style={row.emphasize ? { fontWeight: 700 } : undefined}>
                <span className="ast-totals-label">{row.label}</span>
                <span className="ast-totals-value">{formatValue(raw, row.format, ctx)}</span>
              </div>
            );
          })}
        </div>
      );
    }
    default:
      return null;
  }
};

export interface TemplateReactRendererProps {
  ast: TemplateAst;
  evaluation: TemplateEvaluationResult;
}

export const TemplateAstRenderer: React.FC<TemplateReactRendererProps> = ({ ast, evaluation }) => {
  const invoiceRecord = isRecord(evaluation.bindings.invoice) ? evaluation.bindings.invoice : {};
  const currencyCode = String(
    (invoiceRecord as Record<string, unknown>).currencyCode ?? ast.metadata?.currencyCode ?? 'USD'
  );
  const locale = String(ast.metadata?.locale ?? 'en-US');
  const rootDocumentStyleOverride = resolveSyntheticRootDocumentStyle(ast);

  return (
    <div className="invoice-template-root">
      {renderNode(ast.layout, evaluation, {}, { currencyCode, locale }, rootDocumentStyleOverride)}
    </div>
  );
};

export interface TemplateRenderOutput {
  html: string;
  css: string;
}

export const renderEvaluatedTemplateAst = async (
  ast: TemplateAst,
  evaluation: TemplateEvaluationResult
): Promise<TemplateRenderOutput> => {
  // Next.js app router disallows static imports from react-dom/server in shared modules.
  // Use a dynamic import so this renderer remains server-only at call sites.
  const { renderToStaticMarkup } = await import('react-dom/server');
  return {
    html: renderToStaticMarkup(<TemplateAstRenderer ast={ast} evaluation={evaluation} />),
    css: buildAstCss(ast),
  };
};

