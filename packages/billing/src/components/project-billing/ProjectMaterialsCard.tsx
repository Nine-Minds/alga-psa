'use client';

import { useEffect, useState } from 'react';
import { PackageOpen } from 'lucide-react';
import type { IProjectMaterial } from '@alga-psa/types';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from 'react-i18next';

interface ProjectMaterialsCardProps {
  projectId: string;
  billingCurrency: string | null;
  loadMaterials?: (projectId: string) => Promise<unknown>;
  onManageMaterials?: () => void;
  onOpenInvoice: (invoiceId: string) => void;
}

export default function ProjectMaterialsCard({
  projectId,
  billingCurrency,
  loadMaterials,
  onManageMaterials,
  onOpenInvoice,
}: ProjectMaterialsCardProps) {
  const { t } = useTranslation('features/projects');
  const { currencyCode, money } = useCurrencyFormat();
  const resolvedBillingCurrency = billingCurrency ?? currencyCode;
  const [materials, setMaterials] = useState<IProjectMaterial[]>([]);
  const [loading, setLoading] = useState(Boolean(loadMaterials));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!loadMaterials) {
      setLoading(false);
      return () => { active = false; };
    }

    setLoading(true);
    setError(null);
    loadMaterials(projectId)
      .then((result) => {
        if (!active) return;
        if (isActionMessageError(result) || isActionPermissionError(result)) {
          setMaterials([]);
          setError(getErrorMessage(result));
          return;
        }
        setMaterials(Array.isArray(result) ? result as IProjectMaterial[] : []);
      })
      .catch((cause) => {
        if (!active) return;
        setMaterials([]);
        setError(getErrorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [loadMaterials, projectId]);

  return (
    <Card id="project-billing-materials-card" className="overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-[rgb(var(--color-border-100))] px-4 py-3.5">
        <div>
          <h3 className="text-sm font-bold text-[rgb(var(--color-text-900))]">
            {t('billing.materials.title', 'Materials & products')}
          </h3>
          <p className="mt-0.5 text-xs text-[rgb(var(--color-text-500))]">
            {t('billing.materials.hint', 'Pass-through items billed in addition to the project fee.')}
          </p>
        </div>
        {onManageMaterials && (
          <Button id="project-billing-manage-materials" variant="outline" size="xs" onClick={onManageMaterials}>
            {t('billing.materials.manage', 'Manage products')}
          </Button>
        )}
      </div>

      {loading ? (
        <p className="px-4 py-6 text-sm text-[rgb(var(--color-text-500))]">
          {t('billing.materials.loading', 'Loading products...')}
        </p>
      ) : error ? (
        <p className="px-4 py-4 text-sm text-[rgb(var(--badge-error-text))]">{error}</p>
      ) : materials.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-5 text-sm text-[rgb(var(--color-text-500))]">
          <PackageOpen className="h-5 w-5 text-[rgb(var(--color-text-400))]" />
          {t('billing.materials.empty', 'No products are attached to this project.')}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-[rgb(var(--color-border-100))] text-left text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--color-text-500))]">
                <th className="px-4 py-2">{t('billing.materials.product', 'Product')}</th>
                <th className="px-3 py-2 text-right">{t('billing.materials.quantityRate', 'Qty × rate')}</th>
                <th className="px-3 py-2 text-right">{t('billing.materials.extended', 'Extended')}</th>
                <th className="px-4 py-2 text-right">{t('billing.materials.status', 'Status')}</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((material) => {
                const mismatchedCurrency = material.currency_code !== resolvedBillingCurrency;
                return (
                  <tr
                    key={material.project_material_id}
                    className="border-t border-[rgb(var(--color-border-100))]"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-[rgb(var(--color-text-900))]">
                        {material.service_name ?? material.description ?? t('billing.materials.unnamed', 'Product')}
                      </div>
                      {material.sku && (
                        <div className="mt-0.5 font-mono text-[11px] text-[rgb(var(--color-text-500))]">
                          {material.sku}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-[rgb(var(--color-text-700))]">
                      {material.quantity} × {money(material.rate, material.currency_code)}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-[rgb(var(--color-text-900))]">
                      {money(Math.round(material.quantity * material.rate), material.currency_code)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {mismatchedCurrency && (
                          <Badge variant="warning" size="sm">
                            {material.currency_code}
                          </Badge>
                        )}
                        {material.is_billed && material.billed_invoice_id ? (
                          <button
                            id={`project-material-invoice-${material.project_material_id}`}
                            type="button"
                            onClick={() => onOpenInvoice(material.billed_invoice_id!)}
                            className="font-medium text-primary-600 hover:underline"
                          >
                            {t('billing.materials.billed', 'Billed')}
                          </button>
                        ) : (
                          <Badge variant="secondary" size="sm">
                            {t('billing.materials.unbilled', 'Unbilled')}
                          </Badge>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
