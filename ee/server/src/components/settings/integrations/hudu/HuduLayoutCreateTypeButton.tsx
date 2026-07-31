'use client';

/**
 * F316: per-layout "Create type from this layout" button. Owns the create
 * action call (and ALL of its i18n strings — this component joins the
 * huduI18n scan when the i18n-types group lands its locale entries) and
 * hands translated success/error messages up to the layout-map manager.
 */

import React, { useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Plus, RefreshCw } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { createAssetTypeFromHuduLayout } from '../../../../lib/actions/integrations/huduLayoutMapActions';
import type { HuduCreateTypeFromLayoutResult } from '../../../../lib/actions/integrations/huduLayoutMapActions';

// Explicit type guard: the EE tsconfig is non-strict, where `!result.success`
// alone does not narrow the discriminated union.
function isCreateTypeFailure(
  result: HuduCreateTypeFromLayoutResult
): result is Extract<HuduCreateTypeFromLayoutResult, { success: false }> {
  return !result.success;
}

interface HuduLayoutCreateTypeButtonProps {
  layoutId: number;
  disabled?: boolean;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const HuduLayoutCreateTypeButton: React.FC<HuduLayoutCreateTypeButtonProps> = ({
  layoutId,
  disabled,
  onSuccess,
  onError,
}) => {
  const { t } = useTranslation('msp/integrations');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const result = await createAssetTypeFromHuduLayout({ layoutId });
      if (isCreateTypeFailure(result)) {
        onError(
          result.code === 'slug_conflict' || result.code === 'reserved_slug'
            ? t('integrations.hudu.layoutMap.createType.errors.slugConflict', {
                defaultValue:
                  'An asset type with this name already exists. Choose it from the list instead.',
              })
            : result.error ||
                t('integrations.hudu.layoutMap.createType.errors.create', {
                  defaultValue: 'Failed to create an asset type from this layout.',
                })
        );
        return;
      }
      onSuccess(
        t('integrations.hudu.layoutMap.createType.success', {
          defaultValue: 'Asset type created and assigned to this layout.',
        })
      );
    } catch (err) {
      onError(
        err instanceof Error
          ? err.message
          : t('integrations.hudu.layoutMap.createType.errors.create', {
              defaultValue: 'Failed to create an asset type from this layout.',
            })
      );
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Button
      id={`hudu-layout-create-type-${layoutId}`}
      type="button"
      variant="outline"
      size="xs"
      onClick={() => void handleCreate()}
      disabled={disabled || isCreating}
    >
      {isCreating ? (
        <>
          <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
          {t('integrations.hudu.layoutMap.createType.creating', { defaultValue: 'Creating...' })}
        </>
      ) : (
        <>
          <Plus className="mr-1 h-3 w-3" />
          {t('integrations.hudu.layoutMap.createType.button', { defaultValue: 'Create type from layout' })}
        </>
      )}
    </Button>
  );
};

export default HuduLayoutCreateTypeButton;
