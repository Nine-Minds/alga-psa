'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import AsyncSearchableSelect, { type SelectOption } from '@alga-psa/ui/components/AsyncSearchableSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { addProjectClientItems, listProjectClientAssets } from '../../actions/stagingActions';
import type { StagingTaskOption } from './stagingTypes';

const NO_TASK = '__none__';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
  projectId: string;
  tasks: StagingTaskOption[];
}

const isError = (value: unknown) => isActionMessageError(value) || isActionPermissionError(value);

/**
 * Add equipment the client provides to the project's staging: one of the client's assets, or a described
 * item. Client items are tracked through staging and boxes only: they never become stock and are never billed.
 */
export default function AddClientItemsDialog({ isOpen, onClose, onAdded, projectId, tasks }: Props) {
  const { t } = useTranslation(['features/projects', 'common']);
  const st = useCallback((key: string, fallback: string, options?: Record<string, unknown>) =>
    t(`staging.clientItems.${key}`, { defaultValue: fallback, ...(options ?? {}) }), [t]);
  const [mode, setMode] = useState<'client_asset' | 'client_item'>('client_asset');
  const [assetId, setAssetId] = useState('');
  const [assetLabel, setAssetLabel] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [taskId, setTaskId] = useState(NO_TASK);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setMode('client_asset');
      setAssetId('');
      setAssetLabel('');
      setDescription('');
      setQuantity(1);
      setTaskId(NO_TASK);
      setError(null);
    }
  }, [isOpen]);

  const loadAssets = useCallback(async ({ search }: { search: string; page: number; limit: number }) => {
    const rows = await listProjectClientAssets(projectId, search);
    if (!Array.isArray(rows)) return { options: [], total: 0 };
    const options: SelectOption[] = rows.map((asset) => ({
      value: asset.asset_id,
      label: `${asset.name} (${asset.asset_tag})`,
      secondaryLabel: asset.serial_number ?? undefined,
    }));
    return { options, total: options.length };
  }, [projectId]);

  const handleAdd = async () => {
    setError(null);
    const item = mode === 'client_asset'
      ? (assetId ? { kind: 'client_asset' as const, asset_id: assetId } : null)
      : (description.trim() ? { kind: 'client_item' as const, description: description.trim(), quantity } : null);
    if (!item) {
      setError(mode === 'client_asset' ? st('chooseAsset', 'Choose an asset.') : st('describeItem', 'Describe the item.'));
      return;
    }
    setIsSaving(true);
    try {
      const result = await addProjectClientItems(projectId, { task_id: taskId === NO_TASK ? null : taskId, items: [item] });
      if (isError(result) || !Array.isArray(result)) {
        setError(getErrorMessage(result));
        return;
      }
      onAdded();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : st('failed', 'Could not add the item.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog id="staging-client-items-dialog" isOpen={isOpen} onClose={onClose} title={st('title', 'Add client-provided item')}>
      <DialogContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {st('intro', 'Track equipment the client provides through staging and boxes. It never becomes stock and is never billed.')}
        </p>
        <div className="space-y-2">
          <Label htmlFor="staging-client-items-kind">{st('kind', 'What is it?')}</Label>
          <CustomSelect
            id="staging-client-items-kind"
            options={[
              { value: 'client_asset', label: st('kindAsset', "One of the client's assets") },
              { value: 'client_item', label: st('kindItem', 'Another item (describe it)') },
            ]}
            value={mode}
            onValueChange={(value) => setMode(value as typeof mode)}
          />
        </div>
        {mode === 'client_asset' ? (
          <div className="space-y-2">
            <Label htmlFor="staging-client-items-asset">{st('asset', 'Asset')}</Label>
            <AsyncSearchableSelect
              id="staging-client-items-asset"
              value={assetId}
              selectedLabel={assetLabel}
              onChange={(value, option) => {
                setAssetId(value);
                setAssetLabel(option?.label ?? '');
              }}
              loadOptions={loadAssets}
              limit={100}
              debounceMs={300}
              placeholder={st('assetPlaceholder', 'Select an asset...')}
              searchPlaceholder={st('assetSearch', 'Search by name, tag or serial...')}
              emptyMessage={st('noAssets', 'No assets of this client are available')}
              dropdownMode="overlay"
              maxListHeight="200px"
            />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="staging-client-items-description">{st('description', 'Description')}</Label>
              <Input
                id="staging-client-items-description"
                value={description}
                maxLength={500}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staging-client-items-quantity">{st('quantity', 'Quantity')}</Label>
              <Input
                id="staging-client-items-quantity"
                type="number"
                min={1}
                value={quantity}
                onChange={(event) => setQuantity(Math.floor(Number(event.target.value)))}
              />
            </div>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="staging-client-items-task">{st('task', 'Task')}</Label>
          <CustomSelect
            id="staging-client-items-task"
            options={[
              { value: NO_TASK, label: st('noTask', 'No task') },
              ...tasks.map((task) => ({ value: task.task_id, label: `${task.phase_name}: ${task.task_name}` })),
            ]}
            value={taskId}
            onValueChange={setTaskId}
          />
        </div>
        {error && (
          <Alert variant="destructive" id="staging-client-items-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </DialogContent>
      <DialogFooter>
        <Button id="staging-client-items-cancel" variant="outline" onClick={onClose}>
          {t('common:actions.cancel', 'Cancel')}
        </Button>
        <Button id="staging-client-items-submit" onClick={handleAdd} disabled={isSaving}>
          {isSaving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
          {st('submit', 'Add')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
