'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FieldMappingTemplate, ImportJobRecord } from '@/types/imports.types';

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
  errorSummary: any;
}

const parseJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Request failed');
  }
  return response.json();
};

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
  const fieldDefinitions = useMemo(() => UI_FIELD_DEFINITIONS, []);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [sourcesData, historyData] = await Promise.all([
        parseJson<ImportSourceDTO[]>(await fetch('/api/import/sources')),
        parseJson<ImportJobRecord[]>(await fetch('/api/import/history')),
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
      const template = await parseJson<FieldMappingTemplate>(
        await fetch(`/api/import/mapping?importSourceId=${encodeURIComponent(sourceId)}`)
      );
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

        const result = await parseJson<PreviewResponse>(
          await fetch('/api/import/preview', {
            method: 'POST',
            body: formData,
          })
        );

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
        await parseJson<{ status: string }>(
          await fetch('/api/import/approve', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ importJobId })
          })
        );
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

  return {
    isLoading,
    isApproving,
    error,
    sources,
    history,
    preview,
    fieldDefinitions,
    selectedSourceId,
    setSelectedSourceId,
    fieldMapping,
    setFieldMapping,
    createPreview: handleCreatePreview,
    approveImport: handleApproveImport,
    refresh: fetchData,
  };
};

export type UseImportActionsReturn = ReturnType<typeof useImportActions>;
