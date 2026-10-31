import React from 'react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { DesignerNode } from '../../state/designerStore';
import { useInvoiceDesignerStore } from '../../state/designerStore';
import { getNodeMetadata } from '../../utils/nodeProps';
import {
  buildBundleChildRowsPreset,
  detectBundleChildRowsPreset,
} from '../../../../lib/invoice-template-ast/bundleChildRows';

type Props = { node: DesignerNode };

type PresetValue = 'off' | 'quantities' | 'quantities-and-prices' | 'custom';

/**
 * "Bundle component rows": shows each service of a Fixed contract line as an
 * indented row under its bundle row. "Quantities and prices" binds component
 * prices, which is also what allows them into client-visible invoice data.
 */
export const BundleComponentRowsWidget: React.FC<Props> = ({ node }) => {
  const { t } = useTranslation('msp/invoicing');
  const setNodeProp = useInvoiceDesignerStore((state) => state.setNodeProp);
  const unsetNodeProp = useInvoiceDesignerStore((state) => state.unsetNodeProp);
  const metadata = getNodeMetadata(node) as Record<string, unknown>;
  const current = metadata.bundleChildRows;
  const preset = detectBundleChildRowsPreset(current) as PresetValue;
  const hasChange = JSON.stringify(current ?? '').includes('component.quantityChange');

  const apply = (next: PresetValue, showChange: boolean) => {
    if (next === 'off') {
      unsetNodeProp(node.id, 'metadata.bundleChildRows', true);
      return;
    }
    if (next === 'custom') return;
    setNodeProp(
      node.id,
      'metadata.bundleChildRows',
      buildBundleChildRowsPreset({ prices: next === 'quantities-and-prices', showChange }),
      true,
    );
  };

  const options = [
    { value: 'off', label: t('designer.bundleRows.off', { defaultValue: 'Off' }) },
    { value: 'quantities', label: t('designer.bundleRows.quantities', { defaultValue: 'Quantities only' }) },
    { value: 'quantities-and-prices', label: t('designer.bundleRows.quantitiesAndPrices', { defaultValue: 'Quantities and prices' }) },
    ...(preset === 'custom'
      ? [{ value: 'custom', label: t('designer.bundleRows.custom', { defaultValue: 'Custom (imported)' }) }]
      : []),
  ];

  return (
    <div className="space-y-2" data-testid="bundle-component-rows">
      <CustomSelect
        id="bundle-component-rows-preset"
        value={preset}
        options={options}
        onValueChange={(value) => apply(value as PresetValue, hasChange || preset === 'off')}
      />
      {(preset === 'quantities' || preset === 'quantities-and-prices') && (
        <Checkbox
          id="bundle-component-rows-change"
          label={t('designer.bundleRows.showChange', { defaultValue: 'Show change from the previous period (+N / −N)' })}
          checked={hasChange}
          onChange={(event) => apply(preset, event.target.checked)}
        />
      )}
      <p className="text-xs text-muted-foreground">
        {preset === 'quantities-and-prices'
          ? t('designer.bundleRows.pricesNote', { defaultValue: 'Component prices are included in this template’s invoice data, including for clients.' })
          : t('designer.bundleRows.quantitiesNote', { defaultValue: 'Component prices are not exposed to clients by this template.' })}
      </p>
    </div>
  );
};
