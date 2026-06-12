'use client';

import React from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { AssetTypeField, AssetTypeFieldKind } from '@alga-psa/types';
import {
  ASSET_TYPE_FIELD_KINDS,
  generateAssetTypeSlug,
  type FieldSchemaIssue,
} from '../../lib/assetTypeRegistry';

export interface SchemaEditorField {
  key: string;
  label: string;
  kind: AssetTypeFieldKind;
  required: boolean;
  optionsText: string;
  keyTouched: boolean;
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export function newSchemaEditorField(): SchemaEditorField {
  return { key: '', label: '', kind: 'text', required: false, optionsText: '', keyTouched: false };
}

export function toEditorFields(fields: AssetTypeField[]): SchemaEditorField[] {
  return fields.map((field) => ({
    key: field.key,
    label: field.label,
    kind: field.kind,
    required: Boolean(field.required),
    optionsText: (field.options ?? []).join(', '),
    keyTouched: true,
  }));
}

export function parseOptionsText(optionsText: string): string[] {
  return optionsText
    .split(',')
    .map((option) => option.trim())
    .filter((option) => option.length > 0);
}

export function toFieldsSchema(fields: SchemaEditorField[]): AssetTypeField[] {
  return fields.map((field) => ({
    key: field.key.trim(),
    label: field.label.trim(),
    kind: field.kind,
    ...(field.required ? { required: true } : {}),
    ...(field.kind === 'select' ? { options: parseOptionsText(field.optionsText) } : {}),
  }));
}

export function fieldIssueMessage(issue: FieldSchemaIssue, t: TranslateFn): string {
  switch (issue.code) {
    case 'invalid_key':
      return t('settings.assetTypes.editor.errors.invalidKey', {
        defaultValue: 'Key must start with a lowercase letter and use only lowercase letters, numbers, and underscores.',
      });
    case 'duplicate_key':
      return t('settings.assetTypes.editor.errors.duplicateKey', {
        defaultValue: 'Each field key must be unique.',
      });
    case 'missing_label':
      return t('settings.assetTypes.editor.errors.missingLabel', {
        defaultValue: 'Label is required.',
      });
    case 'invalid_kind':
      return t('settings.assetTypes.editor.errors.invalidKind', {
        defaultValue: 'Choose a valid field kind.',
      });
    case 'invalid_required':
      return t('settings.assetTypes.editor.errors.invalidRequired', {
        defaultValue: 'Required must be on or off.',
      });
    case 'missing_options':
      return t('settings.assetTypes.editor.errors.missingOptions', {
        defaultValue: 'Select fields need at least one option.',
      });
    case 'invalid_options':
      return t('settings.assetTypes.editor.errors.invalidOptions', {
        defaultValue: 'Options must be non-empty values.',
      });
    default:
      return t('settings.assetTypes.editor.errors.invalidField', {
        defaultValue: 'This field is invalid.',
      });
  }
}

const KIND_DEFAULT_LABELS: Record<AssetTypeFieldKind, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  select: 'Select',
  url: 'URL',
  boolean: 'Yes / No',
};

interface AssetTypeSchemaEditorProps {
  fields: SchemaEditorField[];
  onChange: (next: SchemaEditorField[]) => void;
  issues: FieldSchemaIssue[];
}

const AssetTypeSchemaEditor: React.FC<AssetTypeSchemaEditorProps> = ({ fields, onChange, issues }) => {
  const { t } = useTranslation('msp/settings');

  const kindOptions = ASSET_TYPE_FIELD_KINDS.map((kind) => ({
    value: kind,
    label: t(`settings.assetTypes.editor.kinds.${kind}`, { defaultValue: KIND_DEFAULT_LABELS[kind] }),
  }));

  const updateField = (index: number, patch: Partial<SchemaEditorField>) => {
    onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  };

  const moveField = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange(next);
  };

  const removeField = (index: number) => {
    onChange(fields.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">
        {t('settings.assetTypes.editor.title', { defaultValue: 'Fields' })}
      </Label>
      {fields.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t('settings.assetTypes.editor.empty', {
            defaultValue: 'No fields yet. Add fields to build the create/edit form for this type.',
          })}
        </p>
      )}
      {fields.map((field, index) => {
        const fieldIssues = issues.filter((issue) => issue.index === index);
        return (
          <div
            key={index}
            id={`asset-type-field-${index}-row`}
            className="border rounded-md p-3 space-y-2"
          >
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor={`asset-type-field-${index}-label`} className="text-xs">
                  {t('settings.assetTypes.editor.fieldLabel', { defaultValue: 'Label' })}
                </Label>
                <Input
                  id={`asset-type-field-${index}-label`}
                  value={field.label}
                  onChange={(e) =>
                    updateField(index, {
                      label: e.target.value,
                      ...(field.keyTouched ? {} : { key: generateAssetTypeSlug(e.target.value) }),
                    })
                  }
                  placeholder={t('settings.assetTypes.editor.fieldLabelPlaceholder', {
                    defaultValue: 'e.g. Serial Number',
                  })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`asset-type-field-${index}-key`} className="text-xs">
                  {t('settings.assetTypes.editor.fieldKey', { defaultValue: 'Key' })}
                </Label>
                <Input
                  id={`asset-type-field-${index}-key`}
                  value={field.key}
                  onChange={(e) => updateField(index, { key: e.target.value, keyTouched: true })}
                  placeholder={t('settings.assetTypes.editor.fieldKeyPlaceholder', {
                    defaultValue: 'e.g. serial_number',
                  })}
                />
              </div>
            </div>
            <div className="flex items-end gap-3">
              <div className="w-40 space-y-1">
                <Label className="text-xs">
                  {t('settings.assetTypes.editor.fieldKind', { defaultValue: 'Kind' })}
                </Label>
                <CustomSelect
                  id={`asset-type-field-${index}-kind`}
                  options={kindOptions}
                  value={field.kind}
                  onValueChange={(value) => updateField(index, { kind: value as AssetTypeFieldKind })}
                />
              </div>
              <div className="flex items-center gap-2 pb-1">
                <Switch
                  id={`asset-type-field-${index}-required`}
                  checked={field.required}
                  onCheckedChange={(checked) => updateField(index, { required: checked })}
                  label={t('settings.assetTypes.editor.fieldRequired', { defaultValue: 'Required' })}
                />
              </div>
              <div className="flex-1" />
              <div className="flex items-center gap-1 pb-1">
                <Button
                  id={`asset-type-field-${index}-move-up`}
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  onClick={() => moveField(index, -1)}
                  disabled={index === 0}
                  type="button"
                  aria-label={t('settings.assetTypes.editor.moveUp', { defaultValue: 'Move field up' })}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  id={`asset-type-field-${index}-move-down`}
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  onClick={() => moveField(index, 1)}
                  disabled={index === fields.length - 1}
                  type="button"
                  aria-label={t('settings.assetTypes.editor.moveDown', { defaultValue: 'Move field down' })}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  id={`asset-type-field-${index}-remove`}
                  variant="ghost"
                  className="h-8 w-8 p-0 text-destructive"
                  onClick={() => removeField(index)}
                  type="button"
                  aria-label={t('settings.assetTypes.editor.removeField', { defaultValue: 'Remove field' })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {field.kind === 'select' && (
              <div className="space-y-1">
                <Label htmlFor={`asset-type-field-${index}-options`} className="text-xs">
                  {t('settings.assetTypes.editor.fieldOptions', { defaultValue: 'Options (comma-separated)' })}
                </Label>
                <Input
                  id={`asset-type-field-${index}-options`}
                  value={field.optionsText}
                  onChange={(e) => updateField(index, { optionsText: e.target.value })}
                  placeholder={t('settings.assetTypes.editor.fieldOptionsPlaceholder', {
                    defaultValue: 'e.g. Gold, Silver, Bronze',
                  })}
                />
              </div>
            )}
            {fieldIssues.length > 0 && (
              <div id={`asset-type-field-${index}-errors`} className="space-y-1">
                {fieldIssues.map((issue, issueIndex) => (
                  <p key={issueIndex} className="text-sm text-destructive">
                    {fieldIssueMessage(issue, t)}
                  </p>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <Button
        id="assets-types-add-field-button"
        variant="outline"
        onClick={() => onChange([...fields, newSchemaEditorField()])}
        type="button"
      >
        <Plus className="h-4 w-4 mr-2" />
        {t('settings.assetTypes.editor.addField', { defaultValue: 'Add field' })}
      </Button>
    </div>
  );
};

export default AssetTypeSchemaEditor;
