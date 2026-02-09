import type { InvoiceViewModel, WasmInvoiceViewModel } from '@alga-psa/types';
import { DEFAULT_PREVIEW_SAMPLE_ID } from './sampleScenarios';

export type PreviewSourceKind = 'sample' | 'existing';

export type PreviewSessionState = {
  sourceKind: PreviewSourceKind;
  selectedSampleId: string | null;
  selectedInvoiceId: string | null;
  invoiceList: InvoiceViewModel[];
  invoiceListPage: number;
  invoiceListPageSize: number;
  invoiceListTotalPages: number;
  invoiceListTotalCount: number;
  invoiceSearchTerm: string;
  isInvoiceListLoading: boolean;
  invoiceListError: string | null;
  isInvoiceDetailLoading: boolean;
  invoiceDetailError: string | null;
  selectedInvoiceData: WasmInvoiceViewModel | null;
};

type PreviewSessionAction =
  | { type: 'set-source'; source: PreviewSourceKind }
  | { type: 'set-sample'; sampleId: string }
  | { type: 'set-search-term'; value: string }
  | { type: 'set-list-page'; page: number }
  | { type: 'list-load-start' }
  | {
      type: 'list-load-success';
      payload: {
        invoices: InvoiceViewModel[];
        totalPages: number;
        totalCount: number;
        page: number;
      };
    }
  | { type: 'list-load-error'; error: string }
  | { type: 'select-existing-invoice'; invoiceId: string }
  | { type: 'clear-existing-invoice' }
  | { type: 'detail-load-start' }
  | { type: 'detail-load-success'; payload: WasmInvoiceViewModel }
  | { type: 'detail-load-error'; error: string };

export const createInitialPreviewSessionState = (): PreviewSessionState => ({
  sourceKind: 'sample',
  selectedSampleId: DEFAULT_PREVIEW_SAMPLE_ID,
  selectedInvoiceId: null,
  invoiceList: [],
  invoiceListPage: 1,
  invoiceListPageSize: 10,
  invoiceListTotalPages: 0,
  invoiceListTotalCount: 0,
  invoiceSearchTerm: '',
  isInvoiceListLoading: false,
  invoiceListError: null,
  isInvoiceDetailLoading: false,
  invoiceDetailError: null,
  selectedInvoiceData: null,
});

export const previewSessionReducer = (
  state: PreviewSessionState,
  action: PreviewSessionAction
): PreviewSessionState => {
  switch (action.type) {
    case 'set-source':
      return {
        ...state,
        sourceKind: action.source,
      };
    case 'set-sample':
      return {
        ...state,
        selectedSampleId: action.sampleId,
      };
    case 'set-search-term':
      return {
        ...state,
        invoiceSearchTerm: action.value,
        invoiceListPage: 1,
      };
    case 'set-list-page':
      return {
        ...state,
        invoiceListPage: Math.max(1, action.page),
      };
    case 'list-load-start':
      return {
        ...state,
        isInvoiceListLoading: true,
        invoiceListError: null,
      };
    case 'list-load-success':
      return {
        ...state,
        isInvoiceListLoading: false,
        invoiceListError: null,
        invoiceList: action.payload.invoices,
        invoiceListTotalPages: action.payload.totalPages,
        invoiceListTotalCount: action.payload.totalCount,
        invoiceListPage: action.payload.page,
      };
    case 'list-load-error':
      return {
        ...state,
        isInvoiceListLoading: false,
        invoiceListError: action.error,
        invoiceList: [],
        invoiceListTotalPages: 0,
        invoiceListTotalCount: 0,
      };
    case 'select-existing-invoice':
      return {
        ...state,
        selectedInvoiceId: action.invoiceId,
        selectedInvoiceData: null,
        invoiceDetailError: null,
      };
    case 'clear-existing-invoice':
      return {
        ...state,
        selectedInvoiceId: null,
        selectedInvoiceData: null,
        invoiceDetailError: null,
        isInvoiceDetailLoading: false,
      };
    case 'detail-load-start':
      return {
        ...state,
        isInvoiceDetailLoading: true,
        invoiceDetailError: null,
        selectedInvoiceData: null,
      };
    case 'detail-load-success':
      return {
        ...state,
        isInvoiceDetailLoading: false,
        invoiceDetailError: null,
        selectedInvoiceData: action.payload,
      };
    case 'detail-load-error':
      return {
        ...state,
        isInvoiceDetailLoading: false,
        invoiceDetailError: action.error,
        selectedInvoiceData: null,
      };
    default:
      return state;
  }
};
