'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { LayoutGrid, RefreshCw, Save } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getHuduAssetLayoutMap,
  setHuduAssetLayoutMap,
} from '../../../../lib/actions/integrations/huduLayoutMapActions';
import type {
  HuduAssetLayoutMapEntry,
  HuduAssetTypeOption,
  HuduLayoutMapActionResult,
} from '../../../../lib/actions/integrations/huduLayoutMapActions';
import HuduLayoutCreateTypeButton from './HuduLayoutCreateTypeButton';
import { ALGA_ASSET_TYPES, HUDU_LAYOUT_EXCLUDED } from '../../../../lib/integrations/hudu/assetLayoutMap';
import type {
  HuduAssetLayoutTypeMap,
  HuduLayoutAssignment,
} from '../../../../lib/integrations/hudu/assetLayoutMap';

// Explicit type guard: the EE tsconfig is non-strict, where `!result.success`
// alone does not narrow the discriminated union.
function isLayoutMapFailure<T>(
  result: HuduLayoutMapActionResult<T>
): result is Extract<HuduLayoutMapActionResult<T>, { success: false }> {
  return !result.success;
}

const HuduAssetLayoutMapManager: React.FC = () => {
  const { t } = useTranslation('msp/integrations');

  const [layouts, setLayouts] = useState<HuduAssetLayoutMapEntry[]>([]);
  // F315: tenant asset type registry (built-ins + customs) backing the selects.
  const [registryTypes, setRegistryTypes] = useState<HuduAssetTypeOption[]>([]);
  // Each layout's current pick: configured ?? heuristic suggestion (FR12 prefill).
  const [selections, setSelections] = useState<HuduAssetLayoutTypeMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const assetTypeLabel = (assignment: HuduLayoutAssignment): string => {
    switch (assignment) {
      case 'workstation':
        return t('integrations.hudu.layoutMap.types.workstation', { defaultValue: 'Workstation' });
      case 'network_device':
        return t('integrations.hudu.layoutMap.types.networkDevice', { defaultValue: 'Network device' });
      case 'server':
        return t('integrations.hudu.layoutMap.types.server', { defaultValue: 'Server' });
      case 'mobile_device':
        return t('integrations.hudu.layoutMap.types.mobileDevice', { defaultValue: 'Mobile device' });
      case 'printer':
        return t('integrations.hudu.layoutMap.types.printer', { defaultValue: 'Printer' });
      case HUDU_LAYOUT_EXCLUDED:
        return t('integrations.hudu.layoutMap.excludeOption', { defaultValue: "Don't import" });
      default:
        return t('integrations.hudu.layoutMap.types.unknown', { defaultValue: 'Unknown' });
    }
  };

  // Registry-sourced options (custom types use their registry name) with the
  // built-in fallback when the payload carries no registry list.
  const typeOptions = [
    ...(registryTypes.length > 0
      ? registryTypes.map((type) => ({
          value: type.slug,
          label: type.is_builtin ? assetTypeLabel(type.slug) : type.name,
        }))
      : ALGA_ASSET_TYPES.map((assignment) => ({
          value: assignment as string,
          label: assetTypeLabel(assignment),
        }))),
    { value: HUDU_LAYOUT_EXCLUDED as string, label: assetTypeLabel(HUDU_LAYOUT_EXCLUDED) },
  ];

  const loadLayouts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getHuduAssetLayoutMap();
      if (isLayoutMapFailure(result)) {
        setError(
          result.error ||
            t('integrations.hudu.layoutMap.errors.load', {
              defaultValue: 'Failed to load Hudu asset layouts.',
            })
        );
        setLayouts([]);
      } else {
        setLayouts(result.data.layouts);
        setRegistryTypes(result.data.types ?? []);
        const prefill: HuduAssetLayoutTypeMap = {};
        for (const layout of result.data.layouts) {
          prefill[String(layout.id)] = layout.configuredType ?? layout.suggestedType;
        }
        setSelections(prefill);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('integrations.hudu.layoutMap.errors.load', {
              defaultValue: 'Failed to load Hudu asset layouts.',
            })
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadLayouts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = (layoutId: number, assignment: string) => {
    if (isSaving) return;
    setSelections((prev) => ({ ...prev, [String(layoutId)]: assignment as HuduLayoutAssignment }));
  };

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await setHuduAssetLayoutMap(selections);
      if (isLayoutMapFailure(result)) {
        setError(
          result.error ||
            t('integrations.hudu.layoutMap.errors.save', {
              defaultValue: 'Failed to save the asset layout map.',
            })
        );
        return;
      }
      setLayouts((prev) =>
        prev.map((layout) => ({
          ...layout,
          configuredType: result.data.map[String(layout.id)] ?? layout.configuredType,
        }))
      );
      setSuccessMessage(
        t('integrations.hudu.layoutMap.success.saved', { defaultValue: 'Asset layout map saved.' })
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('integrations.hudu.layoutMap.errors.save', {
              defaultValue: 'Failed to save the asset layout map.',
            })
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card id="hudu-asset-layout-map-manager">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5" />
            {t('integrations.hudu.layoutMap.title', { defaultValue: 'Asset Layouts' })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            {t('integrations.hudu.layoutMap.loading', { defaultValue: 'Loading asset layouts...' })}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="hudu-asset-layout-map-manager">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutGrid className="h-5 w-5" />
          {t('integrations.hudu.layoutMap.title', { defaultValue: 'Asset Layouts' })}
        </CardTitle>
        <CardDescription>
          {t('integrations.hudu.layoutMap.description', {
            defaultValue:
              'Choose which AlgaPSA asset type each Hudu asset layout imports as. Unconfigured layouts import as Unknown.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {successMessage && (
          <Alert id="hudu-layout-map-success" variant="success">
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert id="hudu-layout-map-error" variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {layouts.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <LayoutGrid className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">
              {t('integrations.hudu.layoutMap.empty', { defaultValue: 'No asset layouts found in Hudu.' })}
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-lg border">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left text-sm font-medium">
                      {t('integrations.hudu.layoutMap.table.huduLayout', { defaultValue: 'Hudu Layout' })}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium w-64">
                      {t('integrations.hudu.layoutMap.table.algaAssetType', { defaultValue: 'AlgaPSA Asset Type' })}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {layouts.map((layout) => (
                    <tr key={layout.id} className="border-b last:border-b-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="font-medium">{layout.name}</div>
                        {!layout.configuredType && (
                          <div
                            id={`hudu-layout-suggestion-${layout.id}`}
                            className="text-xs text-muted-foreground"
                          >
                            {t('integrations.hudu.layoutMap.suggested', { defaultValue: 'Suggested' })}:{' '}
                            {assetTypeLabel(layout.suggestedType)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-2">
                          <CustomSelect
                            id={`hudu-layout-type-select-${layout.id}`}
                            options={typeOptions}
                            value={selections[String(layout.id)] ?? 'unknown'}
                            onValueChange={(value) => handleSelect(layout.id, value)}
                            disabled={isSaving}
                            className="w-full"
                          />
                          <HuduLayoutCreateTypeButton
                            layoutId={layout.id}
                            disabled={isSaving}
                            onSuccess={(message) => {
                              setError(null);
                              setSuccessMessage(message);
                              void loadLayouts();
                            }}
                            onError={(message) => {
                              setSuccessMessage(null);
                              setError(message);
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end border-t pt-4">
              <Button id="hudu-layout-map-save-btn" size="sm" onClick={() => void handleSave()} disabled={isSaving}>
                {isSaving ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    {t('integrations.hudu.layoutMap.buttons.saving', { defaultValue: 'Saving...' })}
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    {t('integrations.hudu.layoutMap.buttons.save', { defaultValue: 'Save layout map' })}
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default HuduAssetLayoutMapManager;
