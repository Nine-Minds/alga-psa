'use client';

import React from 'react';
import { AlertTriangle, Copy } from 'lucide-react';

import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type SaveAsValidation = {
  type: 'error' | 'warning';
  message: string;
} | null | undefined;

export const WorkflowStepSaveOutputSection: React.FC<{
  stepId: string;
  actionId?: string;
  saveAs?: string;
  saveAsValidation?: SaveAsValidation;
  onSaveAsChange: (value?: string) => void;
  onCopyPath: (path: string) => void;
  generateSaveAsName: (actionId: string) => string;
  disabled?: boolean;
}> = ({
  stepId,
  actionId,
  saveAs,
  saveAsValidation,
  onSaveAsChange,
  onCopyPath,
  generateSaveAsName,
  disabled = false,
}) => {
  const { t } = useTranslation('msp/workflows');
  const currentSaveAs = saveAs ?? '';
  const isSaveEnabled = currentSaveAs.length > 0;

  const handleToggleSave = (enabled: boolean) => {
    if (enabled) {
      // 'result' is a variable-name fallback; stays untranslated since it surfaces as `vars.result` in authored workflows.
      const autoName = actionId ? generateSaveAsName(actionId) : 'result';
      onSaveAsChange(autoName);
      return;
    }

    onSaveAsChange(undefined);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={`workflow-step-saveAs-toggle-${stepId}`} className="text-sm font-medium">
          {t('stepSaveOutput.toggleLabel', { defaultValue: 'Save output' })}
        </Label>
        <Switch
          id={`workflow-step-saveAs-toggle-${stepId}`}
          checked={isSaveEnabled}
          onCheckedChange={handleToggleSave}
          disabled={disabled}
        />
      </div>

      {isSaveEnabled && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Input
              id={`workflow-step-saveAs-${stepId}`}
              placeholder={t('stepSaveOutput.placeholder', { defaultValue: 'e.g., ticketDefaults' })}
              value={currentSaveAs}
              disabled={disabled}
              onChange={(event) => onSaveAsChange(event.target.value.trim() || undefined)}
              className={`flex-1 ${saveAsValidation?.type === 'error' ? 'border-destructive' : saveAsValidation?.type === 'warning' ? 'border-warning' : ''}`}
            />
            <Button
              id={`workflow-step-saveAs-copy-${stepId}`}
              variant="outline"
              size="sm"
              onClick={() => onCopyPath(`vars.${currentSaveAs}`)}
              title={t('stepSaveOutput.copyPathTitle', { defaultValue: 'Copy full path' })}
              className="flex-shrink-0"
              disabled={!currentSaveAs}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-[rgb(var(--color-text-500))]">
            <span>{t('stepSaveOutput.accessibleAs', { defaultValue: 'Accessible as:' })}</span>
            <code className="bg-[rgb(var(--color-border-100))] px-1.5 py-0.5 rounded text-[rgb(var(--color-text-700))] font-mono">
              vars.{currentSaveAs}
            </code>
          </div>

          {saveAsValidation && (
            <div className={`flex items-center gap-1 text-xs ${
              saveAsValidation.type === 'error' ? 'text-destructive' : 'text-warning'
            }`}>
              <AlertTriangle className="w-3 h-3" />
              {saveAsValidation.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
