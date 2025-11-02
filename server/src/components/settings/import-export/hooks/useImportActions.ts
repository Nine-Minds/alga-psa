'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FieldMappingTemplate, ImportJobRecord } from '@/types/imports.types';
import { getAssetFieldDefinitions } from '@/lib/imports/assetFieldDefinitions';

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

export const useImportActions = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [sources, setSources] = useState<ImportSourceDTO[]>([]);
  const [history, setHistory] = useState<ImportJobRecord[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [fieldMapping, setFieldMapping] = useState<FieldMappingTemplate>({});
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fieldDefinitions = useMemo(() => getAssetFieldDefinitions(), []);

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

  return {
    isLoading,
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
    refresh: fetchData,
  };
};

export type UseImportActionsReturn = ReturnType<typeof useImportActions>;
