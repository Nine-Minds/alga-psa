import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { useAssetNotes } from '@alga-psa/assets/hooks/useAssetNotes';
import { DEFAULT_BLOCK, TextEditor } from '@alga-psa/ui/editor';
import { Loader2, Save, StickyNote } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { useContentCardVariant } from '@alga-psa/ui/components';
import { BentoTile } from '@alga-psa/ui/components/bento';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface AssetNotesPanelProps {
  assetId: string;
}

export const AssetNotesPanel: React.FC<AssetNotesPanelProps> = ({
  assetId
}) => {
  const { t } = useTranslation('msp/assets');
  const variant = useContentCardVariant();
  const { 
    noteContent, 
    noteDocument,
    lastUpdated, 
    isLoading, 
    error,
    saveNote, 
    refresh,
    isSaving 
  } = useAssetNotes(assetId);

  // Track local edits for saving (avoid jitter from revalidation).
  const [editorContent, setEditorContent] = useState<any>(null);

  const handleSave = async () => {
    const contentToSave = editorContent ?? noteContent ?? DEFAULT_BLOCK;
    await saveNote(contentToSave);
  };

  if (isLoading) {
    if (variant === 'bento') {
      return (
        <BentoTile
          id="asset-bento-notes"
          title={t('assetNotesPanel.title', { defaultValue: 'Notes' })}
          icon={<StickyNote className="h-4 w-4" />}
        >
          <div className="min-h-[100px] animate-pulse skeleton-fill" />
        </BentoTile>
      );
    }

    return <Card className="h-64 animate-pulse skeleton-fill" />;
  }

  const saveAction = (
    <Button
      id="save-asset-note-btn"
      variant="ghost"
      size="sm"
      className="h-8 gap-2 text-primary-600 hover:text-primary-700 hover:bg-primary-50"
      onClick={handleSave}
      disabled={isSaving || !!error}
    >
      {isSaving ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <Save size={14} />
      )}
      {t('common.actions.save', { defaultValue: 'Save' })}
    </Button>
  );

  const content = (
    <>
      {error && (
        <div className="mb-3">
          <Alert variant="destructive">
            <AlertTitle>
              {t('assetNotesPanel.errors.loadTitle', { defaultValue: 'Notes failed to load' })}
            </AlertTitle>
            <AlertDescription>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">
                  {t('assetNotesPanel.errors.loadDescription', { defaultValue: 'Could not load notes. Please try again.' })}
                </span>
                <Button
                  id="retry-asset-notes-btn"
                  variant="outline"
                  size="sm"
                  onClick={() => void refresh()}
                >
                  {t('common.actions.retry', { defaultValue: 'Retry' })}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      )}
      <div className={variant === 'bento' ? undefined : 'min-h-[200px]'}>
        <TextEditor
          // Remount when the backing document changes (or first loads) so saved notes show up on open.
          key={`${assetId}-${noteDocument?.document_id ?? 'new'}-${noteContent ? 'loaded' : 'empty'}`}
          initialContent={
            noteContent && Array.isArray(noteContent) && noteContent.length > 0
              ? noteContent
              : typeof noteContent === 'string'
              ? noteContent
              : DEFAULT_BLOCK
          }
          onContentChange={setEditorContent}
        />
      </div>

      {lastUpdated && (
        <div className="flex justify-end mt-2">
          <span className="text-xs text-gray-500">
            {t('assetNotesPanel.lastUpdated', {
              defaultValue: 'Last updated: {{value}}',
              value: new Date(lastUpdated).toLocaleString()
            })}
          </span>
        </div>
      )}
    </>
  );

  if (variant === 'bento') {
    return (
      <BentoTile
        id="asset-bento-notes"
        title={t('assetNotesPanel.title', { defaultValue: 'Notes' })}
        icon={<StickyNote className="h-4 w-4" />}
        action={saveAction}
      >
        {content}
      </BentoTile>
    );
  }

  return (
    <Card className="bg-white">
      <CardHeader className="pb-2">
        <div className="flex flex-row items-center justify-between">
          <CardTitle>{t('assetNotesPanel.title', { defaultValue: 'Notes' })}</CardTitle>
          {saveAction}
        </div>
      </CardHeader>
      <CardContent>
        {content}
      </CardContent>
    </Card>
  );
};
