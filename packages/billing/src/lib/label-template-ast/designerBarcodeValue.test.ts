import { describe, expect, it } from 'vitest';
import type { TemplateNode } from '@alga-psa/types';

import { exportWorkspaceToTemplateAst, importTemplateAstToWorkspace } from '../../components/invoice-designer/ast/workspaceAst';
import { findNodeById, getDocumentNode } from '../../components/invoice-designer/ast/workspaceAst.roundtrip.helpers';
import { getStandardLabelTemplateAstByCode, STANDARD_LABEL_ASSET_CODE } from './standardTemplates';
import { WORK_TAG_BARCODE_VALUE_EXAMPLE } from '../../components/invoice-designer/utils/barcodeValueHint';

const qrMetadata = (workspace: ReturnType<typeof importTemplateAstToWorkspace>): Record<string, unknown> => {
  const node = Object.values(workspace.nodesById).find((candidate) => candidate.id === 'qr');
  const metadata = node?.props.metadata;
  if (!metadata || typeof metadata !== 'object') throw new Error('standard label has no qr node metadata');
  return metadata as Record<string, unknown>;
};

describe('designer barcode value on a work-tag template', () => {
  it('imports the standard QR value as the token the hint shows', () => {
    const workspace = importTemplateAstToWorkspace(getStandardLabelTemplateAstByCode(STANDARD_LABEL_ASSET_CODE)!);
    const qr = qrMetadata(workspace);
    expect(qr.value).toBe(WORK_TAG_BARCODE_VALUE_EXAMPLE);
  });

  it('the hinted token {{label.recordUrl}} exports as the record URL, not literal text', () => {
    const workspace = importTemplateAstToWorkspace(getStandardLabelTemplateAstByCode(STANDARD_LABEL_ASSET_CODE)!);
    const qr = qrMetadata(workspace);
    // As if the user added a new barcode block and typed the hinted token (no imported expression).
    delete qr.astValueExpression;
    delete qr.__astValuePreviewValue;
    qr.value = WORK_TAG_BARCODE_VALUE_EXAMPLE;
    const node = findNodeById<TemplateNode & { value: unknown }>(getDocumentNode(exportWorkspaceToTemplateAst(workspace)), 'qr');
    expect(node?.value).not.toMatchObject({ type: 'literal' });
    expect(JSON.stringify(node?.value)).toMatch(/"(url|recordUrl)"/);
  });
});
