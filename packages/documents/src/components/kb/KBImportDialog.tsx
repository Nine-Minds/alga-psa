'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  useArticleAudienceOptions,
  useArticleTypeOptions,
} from '@alga-psa/ui/hooks/useKnowledgeBaseEnumOptions';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Upload, FileText, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  getArticleImportStatus,
  startArticleImport,
  type ArticleAudience,
  type ArticleType,
  type IImportResult,
} from '../../actions/kbArticleActions';
import {
  KB_IMPORT_ALLOWED_EXTENSIONS,
  KB_IMPORT_MAX_FILES,
  KB_IMPORT_MAX_FILE_BYTES,
  KB_IMPORT_MAX_TOTAL_BYTES,
} from '../../lib/kbImportLimits';
import { toast } from 'react-hot-toast';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

interface KBImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

interface PendingFile {
  name: string;
  content: string;
  size: number;
}

const ACCEPTED_EXTENSIONS = KB_IMPORT_ALLOWED_EXTENSIONS;
const POLL_INTERVAL_MS = 2000;
// The job itself times out after 10 minutes; stop polling shortly after so a
// lost job shows an error instead of an endless spinner.
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const MB = 1024 * 1024;

export default function KBImportDialog({ isOpen, onClose, onImportComplete }: KBImportDialogProps) {
  const { t } = useTranslation('msp/knowledge-base');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [audience, setAudience] = useState<ArticleAudience>('internal');
  const [articleType, setArticleType] = useState<ArticleType>('reference');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<IImportResult | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState<{ imported: number; total: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Never leave an interval behind when the dialog unmounts mid-import.
  useEffect(() => stopPolling, [stopPolling]);

  const audienceOptions = useArticleAudienceOptions();
  const articleTypeOptions = useArticleTypeOptions();

  const reset = useCallback(() => {
    stopPolling();
    setFiles([]);
    setResult(null);
    setImporting(false);
    setProgress(null);
    setAudience('internal');
    setArticleType('reference');
  }, [stopPolling]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const readFiles = useCallback(async (fileList: FileList | File[]) => {
    const newFiles: PendingFile[] = [];
    for (const file of Array.from(fileList)) {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        toast.error(t('importDialog.feedback.unsupportedFileType', {
          defaultValue: '{{fileName}}: unsupported file type. Use .md or .html',
          fileName: file.name,
        }));
        continue;
      }
      if (file.size > KB_IMPORT_MAX_FILE_BYTES) {
        toast.error(t('importDialog.feedback.fileTooLarge', {
          defaultValue: '{{fileName}} is larger than {{limit}}MB',
          fileName: file.name,
          limit: Math.floor(KB_IMPORT_MAX_FILE_BYTES / MB),
        }));
        continue;
      }
      const content = await file.text();
      newFiles.push({ name: file.name, content, size: file.size });
    }

    setFiles((prev) => {
      const accepted: PendingFile[] = [];
      let totalBytes = prev.reduce((sum, f) => sum + f.size, 0);

      for (const file of newFiles) {
        if (prev.length + accepted.length >= KB_IMPORT_MAX_FILES) {
          toast.error(t('importDialog.feedback.tooManyFiles', {
            defaultValue: 'You can import at most {{limit}} files at a time',
            limit: KB_IMPORT_MAX_FILES,
          }));
          break;
        }
        if (totalBytes + file.size > KB_IMPORT_MAX_TOTAL_BYTES) {
          toast.error(t('importDialog.feedback.batchTooLarge', {
            defaultValue: 'This batch is larger than {{limit}}MB. Import fewer files at once.',
            limit: Math.floor(KB_IMPORT_MAX_TOTAL_BYTES / MB),
          }));
          break;
        }
        totalBytes += file.size;
        accepted.push(file);
      }

      return [...prev, ...accepted];
    });
  }, [t]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) {
        readFiles(e.target.files);
        e.target.value = '';
      }
    },
    [readFiles]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files?.length) {
        readFiles(e.dataTransfer.files);
      }
    },
    [readFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleImport = useCallback(async () => {
    if (!files.length) return;
    setImporting(true);
    setResult(null);
    setProgress(null);

    const finish = (importResult: IImportResult) => {
      stopPolling();
      setImporting(false);
      setResult(importResult);

      if (importResult.imported > 0) {
        toast.success(t('importDialog.feedback.importSuccess', {
          defaultValue: 'Imported {{imported}} of {{total}} article(s)',
          imported: importResult.imported,
          total: importResult.total,
        }));
        onImportComplete();
      }

      if (importResult.failed.length > 0 && importResult.imported === 0) {
        toast.error(t('importDialog.feedback.allFailed', { defaultValue: 'All imports failed' }));
      }
    };

    try {
      const started = await startArticleImport({
        files: files.map((f) => ({ filename: f.name, content: f.content })),
        audience,
        articleType,
      });

      if (isActionPermissionError(started)) {
        setImporting(false);
        toast.error(t('importDialog.feedback.permissionDenied', { defaultValue: 'Permission denied' }));
        return;
      }

      setProgress({ imported: 0, total: started.total });

      // Parsing runs in a background job, so poll for progress instead of
      // holding the request open.
      stopPolling();
      const startedAt = Date.now();
      pollRef.current = setInterval(async () => {
        try {
          if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            stopPolling();
            setImporting(false);
            toast.error(t('importDialog.feedback.importTimedOut', {
              defaultValue: 'The import is taking longer than expected. Check back shortly.',
            }));
            return;
          }

          const status = await getArticleImportStatus(started.jobId);

          if (isActionPermissionError(status)) {
            stopPolling();
            setImporting(false);
            toast.error(t('importDialog.feedback.permissionDenied', { defaultValue: 'Permission denied' }));
            return;
          }

          setProgress({ imported: status.imported, total: status.total || started.total });

          if (status.status === 'completed' || status.status === 'failed') {
            finish({
              total: status.total || started.total,
              imported: status.imported,
              failed: status.failed,
            });
          }
        } catch (error) {
          stopPolling();
          setImporting(false);
          handleError(error, t('importDialog.feedback.importError', { defaultValue: 'Import failed' }));
        }
      }, POLL_INTERVAL_MS);
    } catch (error) {
      stopPolling();
      setImporting(false);
      handleError(error, t('importDialog.feedback.importError', { defaultValue: 'Import failed' }));
    }
  }, [files, audience, articleType, onImportComplete, stopPolling, t]);

  const footer = result ? (
    <div className="flex justify-end space-x-2">
      <Button id="kb-import-done" variant="default" onClick={handleClose}>
        {t('common.done', 'Done')}
      </Button>
    </div>
  ) : (
    <div className="flex justify-end space-x-2">
      <Button id="kb-import-cancel" variant="outline" onClick={handleClose}>
        {t('common.cancel', 'Cancel')}
      </Button>
      <Button
        id="kb-import-submit"
        onClick={handleImport}
        disabled={files.length === 0 || importing}
      >
        {importing
          ? progress
            ? t('importDialog.actions.importingProgress', {
                defaultValue: 'Imported {{imported}} of {{total}}...',
                imported: progress.imported,
                total: progress.total,
              })
            : t('importDialog.actions.importing', { defaultValue: 'Importing...' })
          : t('importDialog.actions.import', {
              defaultValue: 'Import {{count}} file(s)',
              count: files.length,
            })}
      </Button>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={t('importDialog.title', { defaultValue: 'Import Articles' })}
      className="max-w-lg"
      id="kb-import-dialog"
      footer={footer}
    >
      {result ? (
        // Results view
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm font-medium">
              {t('importDialog.results.summary', {
                defaultValue: '{{imported}} of {{total}} article(s) imported',
                imported: result.imported,
                total: result.total,
              })}
            </span>
          </div>

          {result.failed.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-destructive">
                {t('importDialog.results.failedCount', {
                  defaultValue: '{{count}} failed:',
                  count: result.failed.length,
                })}
              </p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {result.failed.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 p-2 rounded text-sm bg-destructive/10 text-destructive"
                  >
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      <strong>{f.filename}</strong>: {f.error}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        // Upload view
        <div className="space-y-4">
          {/* Drop zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragActive
                ? 'border-primary bg-primary/5'
                : 'border-[rgb(var(--color-border-200))] hover:border-primary/50'
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-medium">
              {t('importDialog.dropzone.title', { defaultValue: 'Drop files here or click to browse' })}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t('importDialog.dropzone.formats', { defaultValue: 'Supports .md and .html files' })}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept=".md,.markdown,.html,.htm"
              onChange={handleFileChange}
            />
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1">
              {files.map((file, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 p-2 rounded bg-[rgb(var(--color-border-100))]"
                >
                  <FileText className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                  <span className="text-sm flex-1 truncate">{file.name}</span>
                  <button
                    onClick={() => removeFile(i)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Options */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                {t('importDialog.fields.audience', { defaultValue: 'Audience' })}
              </label>
              <CustomSelect
                options={audienceOptions}
                value={audience}
                onValueChange={(val) => setAudience(val as ArticleAudience)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                {t('importDialog.fields.articleType', { defaultValue: 'Article Type' })}
              </label>
              <CustomSelect
                options={articleTypeOptions}
                value={articleType}
                onValueChange={(val) => setArticleType(val as ArticleType)}
              />
            </div>
          </div>

        </div>
      )}
    </Dialog>
  );
}
