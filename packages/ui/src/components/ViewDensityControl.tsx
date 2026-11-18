'use client';

import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from './Button';
import { useTranslation } from '../lib/i18n/client';

export interface ViewDensityControlProps {
  value: number;
  onChange: (value: number) => void;
  minValue?: number;
  maxValue?: number;
  defaultValue?: number;
  step?: number;
  idPrefix?: string;
  compactLabel?: string;
  spaciousLabel?: string;
  resetLabel?: string;
  compactTitle?: string;
  decreaseTitle?: string;
  resetTitle?: string;
  increaseTitle?: string;
  spaciousTitle?: string;
  className?: string;
  compactId?: string;
  decreaseId?: string;
  resetId?: string;
  increaseId?: string;
  spaciousId?: string;
}

const ViewDensityControl: React.FC<ViewDensityControlProps> = ({
  value,
  onChange,
  minValue = 0,
  maxValue = 100,
  defaultValue = 50,
  step = 10,
  idPrefix = 'view-density',
  compactLabel,
  spaciousLabel,
  resetLabel,
  compactTitle,
  decreaseTitle,
  resetTitle,
  increaseTitle,
  spaciousTitle,
  className = '',
  compactId,
  decreaseId,
  resetId,
  increaseId,
  spaciousId,
}) => {
  const { t } = useTranslation('common');
  const isAtMin = value <= minValue;
  const isAtMax = value >= maxValue;
  const isAtDefault = value === defaultValue;

  const handleDecrease = () => {
    onChange(Math.max(minValue, value - step));
  };

  const handleIncrease = () => {
    onChange(Math.min(maxValue, value + step));
  };

  return (
    <div className={`flex items-center gap-1.5 ${className}`.trim()}>
      <Button
        id={compactId ?? `${idPrefix}-snap-compact`}
        variant="ghost"
        size="xs"
        onClick={() => onChange(minValue)}
        disabled={isAtMin}
        title={compactTitle ?? t('viewDensity.compact.title')}
        className="!h-6 !px-1 !min-w-0 text-xs text-gray-500 hover:text-gray-700 disabled:text-gray-400"
      >
        {compactLabel ?? t('viewDensity.compact.label')}
      </Button>
      <Button
        id={decreaseId ?? `${idPrefix}-decrease`}
        variant="outline"
        size="xs"
        onClick={handleDecrease}
        disabled={isAtMin}
        title={decreaseTitle ?? t('viewDensity.decrease.title')}
        className="!w-6 !h-6 !p-0 !min-w-0"
      >
        <Minus className="w-3.5 h-3.5" />
      </Button>
      <Button
        id={resetId ?? `${idPrefix}-reset`}
        variant={isAtDefault ? 'outline' : 'ghost'}
        size="xs"
        onClick={() => onChange(defaultValue)}
        disabled={isAtDefault}
        title={resetTitle ?? t('viewDensity.reset.title')}
        className="!h-6 !px-1.5 !min-w-0 text-xs"
      >
        {resetLabel ?? t('actions.reset')}
      </Button>
      <Button
        id={increaseId ?? `${idPrefix}-increase`}
        variant="outline"
        size="xs"
        onClick={handleIncrease}
        disabled={isAtMax}
        title={increaseTitle ?? t('viewDensity.increase.title')}
        className="!w-6 !h-6 !p-0 !min-w-0"
      >
        <Plus className="w-3.5 h-3.5" />
      </Button>
      <Button
        id={spaciousId ?? `${idPrefix}-snap-spacious`}
        variant="ghost"
        size="xs"
        onClick={() => onChange(maxValue)}
        disabled={isAtMax}
        title={spaciousTitle ?? t('viewDensity.spacious.title')}
        className="!h-6 !px-1 !min-w-0 text-xs text-gray-500 hover:text-gray-700 disabled:text-gray-400"
      >
        {spaciousLabel ?? t('viewDensity.spacious.label')}
      </Button>
    </div>
  );
};

export default ViewDensityControl;
