'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IWhitespaceGrid } from '@alga-psa/types';
import { getWhitespaceGrid } from '../../actions/generatorActions';

/**
 * The whole book at a glance: service categories × clients under agreement.
 * An empty cell is unsold ground — clicking it starts the expansion deal.
 */
export function WhitespaceGridView({
  onCellClick,
}: {
  onCellClick: (
    client: { client_id: string; client_name: string },
    category: { category_id: string; category_name: string },
  ) => void;
}) {
  const { t } = useTranslation();
  const [grid, setGrid] = useState<IWhitespaceGrid | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    getWhitespaceGrid()
      .then((g) => mounted && setGrid(g))
      .catch(() => mounted && setFailed(true));
    return () => {
      mounted = false;
    };
  }, []);

  if (failed) return null;
  if (!grid) return <Skeleton className="h-40 w-full" />;
  if (grid.clients.length === 0 || grid.categories.length === 0) {
    return (
      <p className="text-[13px] text-[rgb(var(--color-text-400))]">
        {t('opportunities.whitespace.empty', 'The grid fills in once clients are on active agreements.')}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[rgb(var(--color-border-200))] bg-white">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[rgb(var(--color-border-200))]">
            <th className="sticky left-0 bg-white px-3 py-2 text-left font-semibold text-[rgb(var(--color-text-700))]">
              {t('opportunities.whitespace.client', 'Client')}
            </th>
            {grid.categories.map((cat) => (
              <th key={cat.category_id} className="px-3 py-2 text-center font-medium text-[rgb(var(--color-text-500))]">
                <Tooltip
                  content={t('opportunities.whitespace.adoption', '{{pct}}% of your agreement clients buy this', {
                    pct: Math.round(cat.adoption_percentage),
                  })}
                >
                  <span className="whitespace-nowrap">{cat.category_name}</span>
                </Tooltip>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.clients.map((client) => (
            <tr key={client.client_id} className="border-b border-[rgb(var(--color-border-100,241_245_249))] last:border-b-0">
              <td className="sticky left-0 bg-white px-3 py-1.5 font-medium text-[rgb(var(--color-text-900))]">
                {client.client_name}
              </td>
              {grid.categories.map((cat) => {
                const has = client.cells.find((c) => c.category_id === cat.category_id)?.has_category ?? false;
                return (
                  <td key={cat.category_id} className="px-3 py-1.5 text-center">
                    {has ? (
                      <Check className="mx-auto h-3.5 w-3.5 text-[rgb(var(--badge-success-text))]" aria-hidden />
                    ) : (
                      <button
                        type="button"
                        id={`whitespace-cell-${client.client_id}-${cat.category_id}`}
                        className="mx-auto block h-5 w-5 rounded border border-dashed border-[rgb(var(--color-border-300))] hover:border-[rgb(var(--color-primary-400))] hover:bg-[rgb(var(--color-primary-50))]"
                        aria-label={t('opportunities.whitespace.sell', 'Start {{category}} for {{client}}', {
                          category: cat.category_name,
                          client: client.client_name,
                        })}
                        onClick={() =>
                          onCellClick(
                            { client_id: client.client_id, client_name: client.client_name },
                            { category_id: cat.category_id, category_name: cat.category_name },
                          )
                        }
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
