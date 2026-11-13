'use client';

import React, { useEffect, useState } from 'react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { TicketMaterialMethods } from '../../lib/ticketDataSource';

export default function TicketCatalogCategoryFilter({
  id, value, onChange, loadCategories,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  loadCategories: NonNullable<TicketMaterialMethods['getTicketCatalogCategories']>;
}) {
  const { t } = useTranslation('features/tickets');
  const [categories, setCategories] = useState<Array<{ category_id: string; category_name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    loadCategories().then((result) => {
      if (!cancelled) setCategories(result);
    }).catch((error) => {
      if (cancelled) return;
      handleError(error, t('catalogFilter.loadError'));
      setFailed(true);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [loadCategories, attempt, t]);

  return (
    <div className="border-b border-[rgb(var(--color-border-200))] px-3 py-2">
      <Label htmlFor={id} className="sr-only">{t('catalogFilter.category')}</Label>
      <div className="flex items-center gap-2">
      <CustomSelect id={id} value={value || 'all'} onValueChange={(next) => onChange(next === 'all' ? '' : next)}
        placeholder={t('catalogFilter.category')} showPlaceholderInDropdown={false}
        size="sm" className="min-w-0 max-w-full" customStyles={{ trigger: 'w-auto max-w-full' }}
        disabled={loading || failed}
        options={[{ value: 'all', label: t('catalogFilter.allCategories') },
          ...categories.map((category) => ({ value: category.category_id, label: category.category_name }))]} />
      </div>
      {loading && <p role="status" className="text-xs text-[rgb(var(--color-text-500))]">{t('catalogFilter.loading')}</p>}
      {failed && <div role="alert" className="text-sm text-[rgb(var(--badge-error-text))]">
        {t('catalogFilter.loadError')}
        <Button id={`${id}-retry-button`} variant="ghost" size="sm" onClick={() => setAttempt((previous) => previous + 1)}>{t('catalogFilter.retry')}</Button>
      </div>}
    </div>
  );
}
