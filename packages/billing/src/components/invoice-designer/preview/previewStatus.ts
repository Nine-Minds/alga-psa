import type { WasmInvoiceViewModel } from '@alga-psa/types';
import type { PreviewPipelinePhaseStatus, PreviewSourceKind } from './previewSessionState';

export type PreviewPipelineStatusSnapshot = {
  compileStatus: PreviewPipelinePhaseStatus;
  renderStatus: PreviewPipelinePhaseStatus;
  verifyStatus: PreviewPipelinePhaseStatus;
};

export const hasValidPreviewSelectionForSource = (params: {
  sourceKind: PreviewSourceKind;
  selectedInvoiceId: string | null;
  selectedInvoiceData: WasmInvoiceViewModel | null;
  previewData: WasmInvoiceViewModel | null;
}): boolean => {
  if (params.sourceKind === 'sample') {
    return Boolean(params.previewData);
  }
  return Boolean(params.selectedInvoiceId && params.selectedInvoiceData);
};

export const hasRenderablePreviewOutput = (params: {
  previewData: WasmInvoiceViewModel | null;
  renderStatus: 'idle' | 'success' | 'error';
  html: string | null;
}): boolean =>
  Boolean(params.previewData && params.renderStatus === 'success' && params.html && params.html.trim().length > 0);

export const derivePreviewPipelineDisplayStatuses = (params: {
  statuses: PreviewPipelineStatusSnapshot;
  canDisplaySuccessStates: boolean;
}): PreviewPipelineStatusSnapshot => {
  const normalize = (status: PreviewPipelinePhaseStatus): PreviewPipelinePhaseStatus =>
    status === 'success' && !params.canDisplaySuccessStates ? 'idle' : status;

  return {
    compileStatus: normalize(params.statuses.compileStatus),
    renderStatus: normalize(params.statuses.renderStatus),
    verifyStatus: normalize(params.statuses.verifyStatus),
  };
};
