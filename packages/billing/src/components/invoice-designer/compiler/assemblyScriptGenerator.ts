import type { InvoiceDesignerCompilerIr, InvoiceDesignerIrTreeNode } from './guiIr';

export type InvoiceDesignerSourceMapEntry = {
  nodeId: string;
  symbol: string;
  startLine: number;
  endLine: number;
};

export type GenerateAssemblyScriptResult = {
  source: string;
  sourceHash: string;
  sourceMap: InvoiceDesignerSourceMapEntry[];
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const escapeSourceString = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');

const makeNodeSymbol = (nodeId: string) => `createNode_${nodeId.replace(/[^A-Za-z0-9_]/g, '_')}`;

const createDeterministicSourceHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const resolveNodeText = (node: InvoiceDesignerIrTreeNode): { content: string; variant: string | null } => {
  const metadata = asRecord(node.metadata);

  if (node.type === 'text') {
    const text = asTrimmedString(metadata.text) || node.name;
    const variant = asTrimmedString(metadata.variant) || null;
    return { content: text, variant };
  }

  if (node.type === 'field') {
    const bindingKey =
      asTrimmedString(metadata.bindingKey) ||
      asTrimmedString(metadata.binding) ||
      asTrimmedString(metadata.path);
    return {
      content: bindingKey ? `{{${bindingKey}}}` : node.name,
      variant: null,
    };
  }

  if (node.type === 'label') {
    return {
      content: asTrimmedString(metadata.text) || node.name,
      variant: 'label',
    };
  }

  if (node.type === 'subtotal' || node.type === 'tax' || node.type === 'discount' || node.type === 'custom-total') {
    const label = asTrimmedString(metadata.label) || node.name;
    const bindingKey = asTrimmedString(metadata.bindingKey);
    return {
      content: bindingKey ? `${label}: {{${bindingKey}}}` : label,
      variant: null,
    };
  }

  if (node.type === 'signature') {
    const signer = asTrimmedString(metadata.signerLabel);
    return {
      content: signer ? `Signature: ${signer}` : 'Signature',
      variant: null,
    };
  }

  if (node.type === 'action-button') {
    const label = asTrimmedString(metadata.label);
    return {
      content: label ? `Button: ${label}` : 'Button',
      variant: null,
    };
  }

  if (node.type === 'attachment-list') {
    const title = asTrimmedString(metadata.title);
    return {
      content: title ? `Attachments: ${title}` : 'Attachments',
      variant: null,
    };
  }

  if (node.type === 'divider') {
    return {
      content: '----------------',
      variant: null,
    };
  }

  if (node.type === 'spacer') {
    return {
      content: '',
      variant: null,
    };
  }

  return {
    content: node.name,
    variant: null,
  };
};

const emitNodeFactory = (
  node: InvoiceDesignerIrTreeNode,
  lines: string[],
  sourceMap: InvoiceDesignerSourceMapEntry[]
) => {
  const symbol = makeNodeSymbol(node.id);
  const startLine = lines.length + 1;

  lines.push(`function ${symbol}(viewModel: InvoiceViewModel): LayoutElement {`);

  if (node.type === 'document' || node.type === 'page' || node.type === 'section' || node.type === 'container') {
    lines.push('  const children = new Array<LayoutElement>();');
    node.children.forEach((childNode) => {
      lines.push(`  children.push(${makeNodeSymbol(childNode.id)}(viewModel));`);
    });
    if (node.type === 'document') {
      lines.push('  const node = new DocumentElement(children);');
    } else {
      lines.push('  const node = new SectionElement(children);');
    }
    lines.push(`  node.id = "${escapeSourceString(node.id)}";`);
    lines.push('  return node;');
    lines.push('}');
    const endLine = lines.length;
    sourceMap.push({ nodeId: node.id, symbol, startLine, endLine });
    return;
  }

  if (node.type === 'column') {
    lines.push('  const children = new Array<LayoutElement>();');
    node.children.forEach((childNode) => {
      lines.push(`  children.push(${makeNodeSymbol(childNode.id)}(viewModel));`);
    });
    lines.push('  const node = new ColumnElement(children);');
    const span = Number(asRecord(node.metadata).span);
    lines.push(`  node.span = ${Number.isFinite(span) && span > 0 ? Math.floor(span) : 1};`);
    lines.push(`  node.id = "${escapeSourceString(node.id)}";`);
    lines.push('  return node;');
    lines.push('}');
    const endLine = lines.length;
    sourceMap.push({ nodeId: node.id, symbol, startLine, endLine });
    return;
  }

  if (node.type === 'table' || node.type === 'dynamic-table' || node.type === 'totals') {
    lines.push('  const children = new Array<LayoutElement>();');
    const metadata = asRecord(node.metadata);
    if (node.type === 'table' || node.type === 'dynamic-table') {
      lines.push('  children.push(new TextElement("Table"));');
      const columns = Array.isArray(metadata.columns) ? (metadata.columns as Array<Record<string, unknown>>) : [];
      columns.slice(0, 4).forEach((column) => {
        const header = asTrimmedString(column.header) || asTrimmedString(column.key) || 'Column';
        lines.push(`  children.push(new TextElement("${escapeSourceString(header)}"));`);
      });
    } else {
      lines.push('  children.push(new TextElement("Totals"));');
      lines.push('  children.push(new TextElement("Subtotal"));');
      lines.push('  children.push(new TextElement("Tax"));');
      lines.push('  children.push(new TextElement("Total"));');
    }
    node.children.forEach((childNode) => {
      lines.push(`  children.push(${makeNodeSymbol(childNode.id)}(viewModel));`);
    });
    lines.push('  const node = new SectionElement(children);');
    lines.push(`  node.id = "${escapeSourceString(node.id)}";`);
    lines.push('  return node;');
    lines.push('}');
    const endLine = lines.length;
    sourceMap.push({ nodeId: node.id, symbol, startLine, endLine });
    return;
  }

  if (node.type === 'image' || node.type === 'logo' || node.type === 'qr') {
    const metadata = asRecord(node.metadata);
    const src = asTrimmedString(metadata.src) || asTrimmedString(metadata.url) || '';
    const alt = asTrimmedString(metadata.alt) || node.name || 'Image';
    lines.push(
      `  const node = new ImageElement("${escapeSourceString(src)}", "${escapeSourceString(alt)}");`
    );
    lines.push(`  node.id = "${escapeSourceString(node.id)}";`);
    lines.push('  return node;');
    lines.push('}');
    const endLine = lines.length;
    sourceMap.push({ nodeId: node.id, symbol, startLine, endLine });
    return;
  }

  const text = resolveNodeText(node);
  if (text.variant) {
    lines.push(
      `  const node = new TextElement("${escapeSourceString(text.content)}", "${escapeSourceString(text.variant)}");`
    );
  } else {
    lines.push(`  const node = new TextElement("${escapeSourceString(text.content)}");`);
  }
  lines.push(`  node.id = "${escapeSourceString(node.id)}";`);
  lines.push('  return node;');
  lines.push('}');

  const endLine = lines.length;
  sourceMap.push({ nodeId: node.id, symbol, startLine, endLine });
};

const collectTreeNodes = (root: InvoiceDesignerIrTreeNode): InvoiceDesignerIrTreeNode[] => {
  const nodes: InvoiceDesignerIrTreeNode[] = [];
  const walk = (node: InvoiceDesignerIrTreeNode) => {
    nodes.push(node);
    node.children.forEach((child) => walk(child));
  };
  walk(root);
  return nodes;
};

export const generateAssemblyScriptFromIr = (
  ir: InvoiceDesignerCompilerIr
): GenerateAssemblyScriptResult => {
  const lines: string[] = [];
  const sourceMap: InvoiceDesignerSourceMapEntry[] = [];
  const treeNodes = collectTreeNodes(ir.tree);

  lines.push('import { JSON } from "json-as";');
  lines.push(
    'import { InvoiceViewModel, LayoutElement, DocumentElement, SectionElement, ColumnElement, TextElement, ImageElement } from "../assembly/types";'
  );
  lines.push('');

  treeNodes.forEach((node) => {
    emitNodeFactory(node, lines, sourceMap);
    lines.push('');
  });

  lines.push('// @ts-ignore: decorator');
  lines.push('@unsafe');
  lines.push('export function generateLayout(dataString: string): string {');
  lines.push('  const viewModel = JSON.parse<InvoiceViewModel>(dataString);');
  lines.push(`  const root = ${makeNodeSymbol(ir.rootNodeId)}(viewModel);`);
  lines.push('  return root.toJsonString();');
  lines.push('}');

  const source = lines.join('\n');
  return {
    source,
    sourceHash: createDeterministicSourceHash(source),
    sourceMap,
  };
};
