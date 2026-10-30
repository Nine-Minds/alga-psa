'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Table } from '@alga-psa/ui/components/Table';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import styles from './TicketChargeTable.module.css';

interface ChargeRow {
  id: string;
  name: string;
  description?: string | null;
  quantity: number;
  rate: number;
  currency: string;
  billed: boolean;
  actions?: React.ReactNode;
}

export default function TicketChargeTable({
  rows, itemLabel, money,
}: {
  rows: ChargeRow[];
  itemLabel: string;
  money: (amount: number, currency: string) => string;
}) {
  const { t } = useTranslation('features/tickets');
  const totals = rows.filter((row) => !row.billed).reduce<Record<string, number>>((result, row) => {
    result[row.currency] = (result[row.currency] ?? 0) + row.quantity * row.rate;
    return result;
  }, {});
  const labels = [
    t('materials.qty', 'Qty'), t('materials.rate', 'Rate'),
    t('materials.total', 'Total'), t('materials.status', 'Status'),
  ];

  return (
    <div className={styles.container}>
      <Table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{itemLabel}</th>
            {labels.map((label) => <th key={label} scope="col">{label}</th>)}
            <th scope="col"><span className="sr-only">{t('chargeEdit.edit')}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className={styles.item}>
                <div className="truncate font-medium" title={row.name}>{row.name}</div>
                {row.description && <div className="truncate text-xs text-[rgb(var(--color-text-500))]" title={row.description}>{row.description}</div>}
              </td>
              <td data-label={labels[0]}>{row.quantity}</td>
              <td data-label={labels[1]}>{money(row.rate, row.currency)}</td>
              <td data-label={labels[2]} className="font-medium">{money(row.quantity * row.rate, row.currency)}</td>
              <td data-label={labels[3]}>
                <Badge variant={row.billed ? 'default' : 'outline'}>
                  {row.billed ? t('materials.billed', 'Billed') : t('materials.pending', 'Pending')}
                </Badge>
              </td>
              <td className={styles.actions}><div className="flex items-center justify-end gap-1">{row.actions}</div></td>
            </tr>
          ))}
        </tbody>
      </Table>
      {Object.keys(totals).length > 0 && (
        <div className="space-y-1 border-t border-[rgb(var(--color-border-200))] pt-2 text-right text-sm">
          {Object.entries(totals).map(([currency, total]) => (
            <div key={currency}>
              <span className="text-[rgb(var(--color-text-500))]">{t('materials.unbilled', 'Unbilled ({{currency}}):', { currency })}{' '}</span>
              <span className="font-semibold">{money(total, currency)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
