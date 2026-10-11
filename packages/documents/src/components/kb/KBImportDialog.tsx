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
  resumeArticleImport,
  getUnfinishedArticleImports,
  type IUnfinishedArticleImport,
  type IStartArticleImportResult,
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

interface WatchedImport extends IStartArticleImportResult {
  filename?: string;
}

interface PendingFile {
  name: string;
  content: string;
  size: number;
}

const ACCEPTED_EXTENSIONS = KB_IMPORT_ALLOWED_EXTENSIONS;
const POLL_INTERVAL_MS = 2000;
// Has to outlast the job's worst legitimate case, not just one attempt: an
// attempt runs up to 10 minutes and is retried once, so a worker lost at minute
// nine still finishes a little past twenty. Giving up earlier tells the user the
// import failed while it is still running, and the re-import duplicates the
// whole batch under -2 slugs.
const POLL_TIMEOUT_MS = 25 * 60 * 1000;
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
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollGeneration = useRef(0);
  const [unfinished, setUnfinished] = useState<IUnfinishedArticleImport[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [canResume, setCanResume] = useState(true);
  const [activeBatch, setActiveBatch] = useState<WatchedImport | null>(null);
  const [waiting, setWaiting] = useState<'paused' | 'retry_required' | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [importOffset, setImportOffset] = useState(0);

  const stopPolling = useCallback(() => {
    pollGeneration.current += 1;
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Never leave an interval behind when the dialog unmounts mid-import.
  useEffect(() => stopPolling, [stopPolling]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void getUnfinishedArticleImports(importOffset).then(response => {
      if (cancelled || isActionPermissionError(response)) return;
      setUnfinished(response.imports);
      setHasMore(response.hasMore);
      setCanResume(response.canResume);
    }).catch(error => {
      if (!cancelled) handleError(error, t('importDialog.recovery.loadError', { defaultValue: 'Could not load unfinished imports' }));
    });
    return () => { cancelled = true; };
  }, [isOpen, importOffset, refreshVersion, t]);

  const audienceOptions = useArticleAudienceOptions();
  const articleTypeOptions = useArticleTypeOptions();

  const reset = useCallback(() => {
    stopPolling();
    setFiles([]);
    setResult(null);
    setImporting(false);
    setProgress(null);
    setActiveBatch(null);
    setWaiting(null);
    setImportOffset(0);
    setAudience('internal');
    setArticleType('reference');
  }, [stopPolling]);

  useEffect(() => { if (!isOpen) reset(); }, [isOpen, reset]);

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

  const watchBatch = useCallback((started: WatchedImport) => {
    stopPolling();
    const generation = pollGeneration.current;
    const startedAt = Date.now();
    setActiveBatch(started);
    setWaiting(null);
    setResult(null);
    setImporting(true);
    setProgress({ imported: 0, total: started.total });

    const poll = async () => {
      try {
        const status = await getArticleImportStatus(started.jobId);
        if (generation !== pollGeneration.current) return;
        if (isActionPermissionError(status)) {
          stopPolling();
          setImporting(false);
          toast.error(t('importDialog.feedback.permissionDenied', { defaultValue: 'Permission denied' }));
          return;
        }
        setProgress({ imported: status.imported, total: status.total });
        if (status.status === 'completed' || status.status === 'failed') {
          stopPolling();
          setImporting(false);
          setResult(status);
          setRefreshVersion(version => version + 1);
          if (status.imported > 0) {
            toast.success(t('importDialog.feedback.importSuccess', {
              defaultValue: 'Imported {{imported}} of {{total}} article(s)', imported: status.imported, total: status.total,
            }));
            onImportComplete();
          } else if (status.failed.length) {
            toast.error(t('importDialog.feedback.allFailed', { defaultValue: 'All imports failed' }));
          }
        } else if (status.status === 'paused' || status.status === 'retry_required' || Date.now() - startedAt > POLL_TIMEOUT_MS) {
          stopPolling();
          setImporting(false);
          setWaiting(status.status === 'paused' ? 'paused' : 'retry_required');
          setRefreshVersion(version => version + 1);
          if (status.imported > 0) onImportComplete();
        } else {
          pollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (generation !== pollGeneration.current) return;
        stopPolling();
        setImporting(false);
        setWaiting('retry_required');
        handleError(error, t('importDialog.feedback.importError', { defaultValue: 'Import failed' }));
      }
    };
    void poll();
  }, [onImportComplete, stopPolling, t]);

  const handleImport = useCallback(async () => {
    if (!files.length) return;
    setImporting(true);
    setResult(null);
    setProgress(null);
    const generation = pollGeneration.current;
    try {
      const started = await startArticleImport({ files: files.map(f => ({ filename: f.name, content: f.content })), audience, articleType });
      if (generation !== pollGeneration.current) return;
      if (isActionPermissionError(started)) {
        setImporting(false);
        toast.error(t('importDialog.feedback.permissionDenied', { defaultValue: 'Permission denied' }));
        return;
      }
      setFiles([]);
      watchBatch({ ...started, filename: files[0]?.name });
    } catch (error) {
      if (generation !== pollGeneration.current) return;
      setImporting(false);
      handleError(error, t('importDialog.feedback.importError', { defaultValue: 'Import failed' }));
    }
  }, [files, audience, articleType, watchBatch, t]);

  const handleResume = useCallback(async (jobId: string) => {
    stopPolling();
    const generation = pollGeneration.current;
    setImporting(true);
    try {
      const started = await resumeArticleImport(jobId);
      if (generation !== pollGeneration.current) return;
      if (isActionPermissionError(started)) {
        setImporting(false);
        toast.error(t('importDialog.feedback.permissionDenied', { defaultValue: 'Permission denied' }));
        return;
      }
      watchBatch({ ...started, filename: activeBatch?.filename });
    } catch (error) {
      if (generation !== pollGeneration.current) return;
      setImporting(false);
      setRefreshVersion(version => version + 1);
      handleError(error, t('importDialog.feedback.importError', { defaultValue: 'Import failed' }));
    }
  }, [stopPolling, watchBatch, t, activeBatch?.filename]);

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
        disabled={files.length === 0 || importing || !canResume}
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
          {(!canResume || waiting || unfinished.length > 0 || importOffset > 0) && (
            <div className="space-y-3 rounded-lg border border-[rgb(var(--color-border-200))] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{t('importDialog.recovery.title', { defaultValue: 'Unfinished imports' })}</p>
                <Button id="kb-import-refresh" variant="ghost" disabled={importing} onClick={() => setRefreshVersion(version => version + 1)}>
                  {t('importDialog.recovery.refresh', { defaultValue: 'Refresh' })}
                </Button>
              </div>
              {(!canResume || waiting) && (
                <p role="status" className="text-sm text-muted-foreground">
                  {!canResume
                    ? t('importDialog.recovery.paused', { defaultValue: 'Imports are paused for this workspace. Your files are saved.' })
                    : t('importDialog.recovery.retry', { defaultValue: 'Your files are saved. Resume the import to continue without uploading them again.' })}
                </p>
              )}
              {waiting && activeBatch && (
                <div className="space-y-2">
                  {activeBatch.filename && <p className="truncate text-sm font-medium">{activeBatch.filename}</p>}
                  <Button id="kb-import-resume-current" variant="outline" disabled={importing || !canResume} onClick={() => handleResume(activeBatch.jobId)}>
                    {t('importDialog.recovery.resume', { defaultValue: 'Resume import' })}
                  </Button>
                </div>
              )}
              {unfinished.map(batch => (
                <div key={batch.jobId} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">{batch.filename}</span>
                    <span className="text-xs text-muted-foreground">{t('importDialog.recovery.remaining', {
                      defaultValue: '{{pending}} of {{total}} files remaining', pending: batch.pending, total: batch.total,
                    })}</span>
                  </span>
                  <Button id={`kb-import-open-${batch.jobId}`} variant="outline" disabled={importing} onClick={() => watchBatch(batch)}>
                    {t('importDialog.recovery.open', { defaultValue: 'View progress' })}
                  </Button>
                </div>
              ))}
              {(importOffset > 0 || hasMore) && (
                <div className="flex justify-end gap-2">
                  <Button id="kb-import-previous" variant="ghost" disabled={importing || importOffset === 0} onClick={() => setImportOffset(offset => Math.max(0, offset - 20))}>
                    {t('importDialog.recovery.previous', { defaultValue: 'Previous' })}
                  </Button>
                  <Button id="kb-import-next" variant="ghost" disabled={importing || !hasMore} onClick={() => setImportOffset(offset => offset + 20)}>
                    {t('importDialog.recovery.next', { defaultValue: 'Next' })}
                  </Button>
                </div>
              )}
            </div>
          )}

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
