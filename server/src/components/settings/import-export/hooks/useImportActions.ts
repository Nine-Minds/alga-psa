'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FieldMappingTemplate, ImportJobDetails, ImportJobRecord } from '@/types/imports.types';
import {
  approveImport as approveImportAction,
  createImportPreview as createImportPreviewAction,
  getImportFieldMapping,
  getImportJobDetails,
  getImportSources,
  listImportJobs,
} from '@alga-psa/reference-data/actions';

interface ImportSourceDTO {
  import_source_id: string;
  name: string;
  description: string | null;
  source_type: string;
}

interface PreviewResponse {
  importJobId: string;
  preview: {
    rows: any[];
    summary: {
      totalRows: number;
      validRows: number;
      duplicateRows: number;
      errorRows: number;
    };
    columnExamples?: Record<string, unknown[]>;
  };
  errorSummary: unknown;
}

const UI_FIELD_DEFINITIONS = [
  { field: 'name', label: 'Asset Name', required: true, example: 'NYC-WS-001' },
  { field: 'asset_type', label: 'Asset Type', required: true, example: 'workstation' },
  { field: 'serial_number', label: 'Serial Number', required: false, example: 'SN-123456' },
  { field: 'asset_tag', label: 'Asset Tag', required: false, example: 'TAG-001' },
  { field: 'mac_address', label: 'MAC Address', required: false, example: '00:11:22:33:44:55' },
  { field: 'ip_address', label: 'IP Address', required: false, example: '10.0.0.5' },
  { field: 'purchase_date', label: 'Purchase Date', required: false, example: '2025-01-15' },
  { field: 'warranty_end_date', label: 'Warranty End Date', required: false, example: '2027-01-15' },
] as const;

export const useImportActions = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [sources, setSources] = useState<ImportSourceDTO[]>([]);
  const [history, setHistory] = useState<ImportJobRecord[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [fieldMapping, setFieldMapping] = useState<FieldMappingTemplate>({});
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [selectedJobDetails, setSelectedJobDetails] = useState<ImportJobDetails | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isRefreshingHistory, setIsRefreshingHistory] = useState(false);
  const fieldDefinitions = useMemo(() => UI_FIELD_DEFINITIONS, []);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [sourcesData, historyData] = await Promise.all([
        getImportSources(),
        listImportJobs(),
      ]);

      setSources(sourcesData);
      setHistory(historyData);

      if (!selectedSourceId && sourcesData.length > 0) {
        setSelectedSourceId(sourcesData[0].import_source_id);
      }
    } catch (error) {
      console.error('[ImportActions] fetchData error', error);
      setError(error instanceof Error ? error.message : 'Failed to load import data');
    } finally {
      setIsLoading(false);
    }
  }, [selectedSourceId]);

  const loadMappingTemplate = useCallback(async (sourceId: string) => {
    try {
      const template = await getImportFieldMapping(sourceId);
      setFieldMapping(template ?? {});
    } catch (error) {
      console.warn('[ImportActions] loadMappingTemplate error', error);
      setFieldMapping({});
    }
  }, []);

  const initialize = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (selectedSourceId) {
      loadMappingTemplate(selectedSourceId);
    }
  }, [selectedSourceId, loadMappingTemplate]);

  const handleCreatePreview = useCallback(
    async (data: { importSourceId: string; mapping: FieldMappingTemplate; file: File; persistTemplate: boolean }) => {
      setIsLoading(true);
      setError(null);

      try {
        const formData = new FormData();
        formData.append('importSourceId', data.importSourceId);
        formData.append('fieldMapping', JSON.stringify(
          Object.entries(data.mapping).map(([sourceField, { target }]) => ({
            sourceField,
            targetField: target,
          }))
        ));
        formData.append('persistTemplate', String(data.persistTemplate));
        formData.append('file', data.file);

        const result = await createImportPreviewAction(formData);

        setPreview(result);
        await fetchData();
      } catch (error) {
        console.error('[ImportActions] createPreview error', error);
        setError(error instanceof Error ? error.message : 'Failed to create preview');
      } finally {
        setIsLoading(false);
      }
    },
    [fetchData]
  );

  const handleApproveImport = useCallback(
    async (importJobId: string) => {
      if (!importJobId) {
        setError('Select a preview to approve before importing.');
        return;
      }

      setIsApproving(true);
      setError(null);
      try {
        await approveImportAction(importJobId);
        setPreview(null);
        await fetchData();
      } catch (error) {
        console.error('[ImportActions] approveImport error', error);
        setError(error instanceof Error ? error.message : 'Failed to start import job');
      } finally {
        setIsApproving(false);
      }
    },
    [fetchData]
  );

  const loadJobDetails = useCallback(
    async (importJobId: string) => {
      setIsLoadingDetails(true);
      setDetailsError(null);
      try {
        const details = await getImportJobDetails(importJobId);
        setSelectedJobDetails(details);
      } catch (error) {
        console.error('[ImportActions] getImportJobDetails error', error);
        setDetailsError(error instanceof Error ? error.message : 'Failed to load job details');
        setSelectedJobDetails(null);
      } finally {
        setIsLoadingDetails(false);
      }
    },
    []
  );

  const clearSelectedJobDetails = useCallback(() => {
    setSelectedJobDetails(null);
    setDetailsError(null);
  }, []);

  const refreshHistory = useCallback(async () => {
    setIsRefreshingHistory(true);
    try {
      const historyData = await listImportJobs();
      setHistory(historyData);

      if (selectedJobDetails?.import_job_id) {
        await loadJobDetails(selectedJobDetails.import_job_id);
      }
    } catch (error) {
      console.error('[ImportActions] refreshHistory error', error);
      setError(error instanceof Error ? error.message : 'Failed to refresh import history');
    } finally {
      setIsRefreshingHistory(false);
    }
  }, [loadJobDetails, selectedJobDetails]);

  return {
    isLoading,
    isApproving,
    error,
    detailsError,
    isLoadingDetails,
    isRefreshingHistory,
    sources,
    history,
    preview,
    selectedJobDetails,
    fieldDefinitions,
    selectedSourceId,
    setSelectedSourceId,
    fieldMapping,
    setFieldMapping,
    createPreview: handleCreatePreview,
    approveImport: handleApproveImport,
    loadJobDetails,
    clearSelectedJobDetails,
    refreshHistory,
    refreshAll: fetchData,
    refresh: fetchData,
  };
};

export type UseImportActionsReturn = ReturnType<typeof useImportActions>;
