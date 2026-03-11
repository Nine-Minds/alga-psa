'use client';

import React, { useState, useRef, useCallback } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Upload, FileText, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  importArticles,
  type ArticleAudience,
  type ArticleType,
  type IImportResult,
} from '../../actions/kbArticleActions';
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
}

const ACCEPTED_EXTENSIONS = ['.md', '.markdown', '.html', '.htm'];

const AUDIENCE_OPTIONS = [
  { value: 'internal', label: 'Internal' },
  { value: 'client', label: 'Client' },
  { value: 'public', label: 'Public' },
];

const ARTICLE_TYPE_OPTIONS = [
  { value: 'reference', label: 'Reference' },
  { value: 'how_to', label: 'How-To' },
  { value: 'faq', label: 'FAQ' },
  { value: 'troubleshooting', label: 'Troubleshooting' },
];

export default function KBImportDialog({ isOpen, onClose, onImportComplete }: KBImportDialogProps) {
  const { t } = useTranslation('features/documents');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [audience, setAudience] = useState<ArticleAudience>('internal');
  const [articleType, setArticleType] = useState<ArticleType>('reference');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<IImportResult | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const reset = useCallback(() => {
    setFiles([]);
    setResult(null);
    setImporting(false);
    setAudience('internal');
    setArticleType('reference');
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const readFiles = useCallback(async (fileList: FileList | File[]) => {
    const newFiles: PendingFile[] = [];
    for (const file of Array.from(fileList)) {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        toast.error(`${file.name}: unsupported file type. Use .md or .html`);
        continue;
      }
      const content = await file.text();
      newFiles.push({ name: file.name, content });
    }
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

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

    try {
      const importResult = await importArticles({
        files: files.map((f) => ({ filename: f.name, content: f.content })),
        audience,
        articleType,
      });

      if (isActionPermissionError(importResult)) {
        toast.error('Permission denied');
        return;
      }

      setResult(importResult);

      if (importResult.imported > 0) {
        toast.success(
          `Imported ${importResult.imported} of ${importResult.total} article${importResult.total !== 1 ? 's' : ''}`
        );
        onImportComplete();
      }

      if (importResult.failed.length > 0 && importResult.imported === 0) {
        toast.error('All imports failed');
      }
    } catch (error) {
      handleError(error, 'Import failed');
    } finally {
      setImporting(false);
    }
  }, [files, audience, articleType, onImportComplete]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={t('kb.importTitle', 'Import Articles')}
      className="max-w-lg"
      id="kb-import-dialog"
    >
      {result ? (
        // Results view
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm font-medium">
              {result.imported} of {result.total} article{result.total !== 1 ? 's' : ''} imported
            </span>
          </div>

          {result.failed.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-destructive">
                {result.failed.length} failed:
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

          <DialogFooter>
            <Button id="kb-import-done" variant="default" onClick={handleClose}>
              {t('common.done', 'Done')}
            </Button>
          </DialogFooter>
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
              {t('kb.importDropzone', 'Drop files here or click to browse')}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t('kb.importFormats', 'Supports .md and .html files')}
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
                {t('kb.audience', 'Audience')}
              </label>
              <CustomSelect
                options={AUDIENCE_OPTIONS}
                value={audience}
                onValueChange={(val) => setAudience(val as ArticleAudience)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                {t('kb.articleType', 'Article Type')}
              </label>
              <CustomSelect
                options={ARTICLE_TYPE_OPTIONS}
                value={articleType}
                onValueChange={(val) => setArticleType(val as ArticleType)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button id="kb-import-cancel" variant="outline" onClick={handleClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              id="kb-import-submit"
              onClick={handleImport}
              disabled={files.length === 0 || importing}
            >
              {importing
                ? t('kb.importing', 'Importing...')
                : t('kb.importCount', `Import ${files.length} file${files.length !== 1 ? 's' : ''}`)}
            </Button>
          </DialogFooter>
        </div>
      )}
    </Dialog>
  );
}
