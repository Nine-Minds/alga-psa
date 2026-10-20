import type { TemplateAst, TemplateBarcodeNode, TemplateNode } from '@alga-psa/types';
import type { TemplateEvaluationResult } from '../evaluator';
import { resolveTemplateExpressionValue } from '../react-renderer';
import {
  BarcodeError,
  code128BarsToSvg,
  cssLengthToMm,
  qrMatrixToSvg,
} from './constraints';

/** Map of barcode node id -> inline SVG, handed to the synchronous renderer. */
export type BarcodeSvgMap = Record<string, string>;

const collectBarcodeNodes = (node: TemplateNode, out: TemplateBarcodeNode[]): void => {
  if (node.type === 'barcode') out.push(node);
  for (const child of node.children ?? []) collectBarcodeNodes(child, out);
};

export const findBarcodeNodes = (ast: TemplateAst): TemplateBarcodeNode[] => {
  const nodes: TemplateBarcodeNode[] = [];
  collectBarcodeNodes(ast.layout, nodes);
  return nodes;
};

/**
 * Async server prepass: evaluate each barcode node's value and render it to SVG. Returns an empty
 * map (and loads no library) when the template has no barcode node. Any failure to encode or to fit
 * throws a BarcodeError naming the node, so a bad label fails loudly instead of printing an
 * unscannable code.
 */
export const renderBarcodeSvgs = async (
  ast: TemplateAst,
  evaluation: TemplateEvaluationResult,
  options: { locale?: string } = {}
): Promise<BarcodeSvgMap> => {
  const nodes = findBarcodeNodes(ast);
  if (nodes.length === 0) return {};
  const encoders = await import('./encode.server');
  const svgs: BarcodeSvgMap = {};
  for (const node of nodes) {
    const raw = resolveTemplateExpressionValue(node.value, ast, evaluation, options);
    const value = raw == null ? '' : String(raw);
    try {
      if (value.trim().length === 0) {
        throw new BarcodeError('empty-value', 'Barcode value is empty');
      }
      const declaredWidthMm = cssLengthToMm(node.style?.inline?.width);
      const declaredHeightMm = cssLengthToMm(node.style?.inline?.height);
      svgs[node.id] =
        node.symbology === 'qr'
          ? qrMatrixToSvg(await encoders.encodeQr(value), declaredWidthMm, `QR code`)
          : code128BarsToSvg(await encoders.encodeCode128(value), declaredWidthMm, `Code 128 barcode`, declaredHeightMm);
    } catch (error) {
      if (error instanceof BarcodeError) {
        throw new BarcodeError(error.code, `Barcode "${node.id}": ${error.message}`);
      }
      throw error;
    }
  }
  return svgs;
};
