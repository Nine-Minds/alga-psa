import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  InvoiceTemplateAst,
  InvoiceTemplateNode,
  InvoiceTemplateStyleDeclaration,
  InvoiceTemplateValueExpression,
} from '@alga-psa/types';
import type { InvoiceTemplateEvaluationResult } from './evaluator';

type UnknownRecord = Record<string, unknown>;

type RenderScope = {
  row?: UnknownRecord;
};

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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

const toCssValue = (value: string | number): string =>
  typeof value === 'number' ? String(value) : value;

const styleDeclarationToCss = (declaration: InvoiceTemplateStyleDeclaration): string =>
  Object.entries(declaration)
    .map(([key, value]) => {
      const cssKey = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
      return `${cssKey}: ${toCssValue(value as string | number)};`;
    })
    .join(' ');

const styleDeclarationToReactStyle = (
  declaration?: InvoiceTemplateStyleDeclaration
): React.CSSProperties | undefined => {
  if (!declaration) {
    return undefined;
  }
  return declaration as React.CSSProperties;
};

const buildAstCss = (ast: InvoiceTemplateAst): string => {
  const classRules = Object.entries(ast.styles?.classes ?? {})
    .map(([className, declaration]) => `.ast-${className} { ${styleDeclarationToCss(declaration)} }`)
    .join('\n');

  const tokenRules = Object.values(ast.styles?.tokens ?? {})
    .map((token) => `--${token.id}: ${toCssValue(token.value)};`)
    .join(' ');

  const rootRule = tokenRules.length > 0 ? `.invoice-template-root { ${tokenRules} }\n` : '';
  return `${rootRule}${classRules}`.trim();
};

const resolveExpressionValue = (
  expression: InvoiceTemplateValueExpression,
  evaluation: InvoiceTemplateEvaluationResult,
  scope: RenderScope
): unknown => {
  switch (expression.type) {
    case 'literal':
      return expression.value;
    case 'binding':
      return evaluation.bindings[expression.bindingId];
    case 'path': {
      const rowValue = scope.row ? getPathValue(scope.row, expression.path) : undefined;
      if (rowValue !== undefined) {
        return rowValue;
      }
      const invoiceValue = getPathValue(evaluation.bindings.invoice, expression.path);
      if (invoiceValue !== undefined) {
        return invoiceValue;
      }
      return undefined;
    }
    case 'template': {
      const args = expression.args ?? {};
      return expression.template.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g, (_match, name: string) => {
        const arg = args[name];
        if (arg) {
          const argValue = resolveExpressionValue(arg, evaluation, scope);
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

const resolveCollection = (
  bindingId: string,
  evaluation: InvoiceTemplateEvaluationResult
): UnknownRecord[] => {
  const value = evaluation.bindings[bindingId];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord);
};

const resolveClassNames = (node: InvoiceTemplateNode): string =>
  (node.style?.tokenIds ?? []).map((tokenId) => `ast-${tokenId}`).join(' ');

const renderNode = (
  node: InvoiceTemplateNode,
  evaluation: InvoiceTemplateEvaluationResult,
  scope: RenderScope
): React.ReactNode => {
  const className = resolveClassNames(node);
  const style = styleDeclarationToReactStyle(node.style?.inline);

  switch (node.type) {
    case 'document':
      return (
        <div key={node.id} id={node.id} className={className || undefined} style={style}>
          {node.children.map((child) => renderNode(child, evaluation, scope))}
        </div>
      );
    case 'section':
      return (
        <section key={node.id} id={node.id} className={className || undefined} style={style}>
          {node.title ? <h2>{node.title}</h2> : null}
          {node.children.map((child) => renderNode(child, evaluation, scope))}
        </section>
      );
    case 'stack':
      return (
        <div key={node.id} id={node.id} className={className || undefined} style={style}>
          {node.children.map((child) => renderNode(child, evaluation, scope))}
        </div>
      );
    case 'text': {
      const content = resolveExpressionValue(node.content, evaluation, scope);
      return (
        <p key={node.id} id={node.id} className={className || undefined} style={style}>
          {String(content ?? '')}
        </p>
      );
    }
    case 'field': {
      const value = evaluation.bindings[node.binding.bindingId];
      return (
        <div key={node.id} id={node.id} className={className || undefined} style={style}>
          {node.label ? <span>{node.label}: </span> : null}
          <span>{String(value ?? node.emptyValue ?? '')}</span>
        </div>
      );
    }
    case 'image': {
      const src = resolveExpressionValue(node.src, evaluation, scope);
      const alt = node.alt ? resolveExpressionValue(node.alt, evaluation, scope) : '';
      return (
        <img
          key={node.id}
          id={node.id}
          className={className || undefined}
          style={style}
          src={String(src ?? '')}
          alt={String(alt ?? '')}
        />
      );
    }
    case 'divider':
      return <hr key={node.id} id={node.id} className={className || undefined} style={style} />;
    case 'table': {
      const rows = resolveCollection(node.sourceBinding.bindingId, evaluation);
      return (
        <table key={node.id} id={node.id} className={className || undefined} style={style}>
          <thead>
            <tr>
              {node.columns.map((column) => (
                <th key={column.id}>{column.header ?? column.id}</th>
              ))}
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
                    const value = resolveExpressionValue(column.value, evaluation, {
                      row,
                    });
                    return <td key={column.id}>{String(value ?? '')}</td>;
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
        <table key={node.id} id={node.id} className={className || undefined} style={style}>
          <thead>
            <tr>
              {node.columns.map((column) => (
                <th key={column.id}>{column.header ?? column.id}</th>
              ))}
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
                    const value = resolveExpressionValue(column.value, evaluation, {
                      row,
                    });
                    return <td key={column.id}>{String(value ?? '')}</td>;
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
        <div key={node.id} id={node.id} className={className || undefined} style={style}>
          {node.rows.map((row) => (
            <div key={row.id} style={row.emphasize ? { fontWeight: 700 } : undefined}>
              <span>{row.label}</span>
              <span>{String(totals[row.id] ?? resolveExpressionValue(row.value, evaluation, scope) ?? '')}</span>
            </div>
          ))}
        </div>
      );
    }
    default:
      return null;
  }
};

export interface InvoiceTemplateReactRendererProps {
  ast: InvoiceTemplateAst;
  evaluation: InvoiceTemplateEvaluationResult;
}

export const InvoiceTemplateAstRenderer: React.FC<InvoiceTemplateReactRendererProps> = ({ ast, evaluation }) => (
  <div className="invoice-template-root">{renderNode(ast.layout, evaluation, {})}</div>
);

export interface InvoiceTemplateRenderOutput {
  html: string;
  css: string;
}

export const renderEvaluatedInvoiceTemplateAst = (
  ast: InvoiceTemplateAst,
  evaluation: InvoiceTemplateEvaluationResult
): InvoiceTemplateRenderOutput => ({
  html: renderToStaticMarkup(<InvoiceTemplateAstRenderer ast={ast} evaluation={evaluation} />),
  css: buildAstCss(ast),
});
