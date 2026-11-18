'use client';

import React from 'react';
import toast from 'react-hot-toast';
import { MoreVertical } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@alga-psa/ui/components/DropdownMenu';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import type { ColumnDefinition } from '@alga-psa/types';
import {
  discardPriceBookAction,
  downloadPriceBookCsvAction,
  listPriceBooksAction,
  makePriceBookActiveAgainAction,
  previewMakePriceBookActiveAgainAction,
  withdrawPriceBookAction,
  type MakeActiveAgainPreview,
} from '@alga-psa/billing/actions/priceBookActions';
import type { PriceBookDisplayStatus, PriceBookSummary } from '@alga-psa/billing/lib/catalog/priceBooks';
import PriceBookImportDialog from './PriceBookImportDialog';

const STATUS_VARIANT: Record<PriceBookDisplayStatus, BadgeVariant> = {
  active: 'success', scheduled: 'info', superseded: 'default-muted', draft: 'warning',
};
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * Billing settings → Price books. Each price book is a named, dated group of
 * catalog prices; which one is "active" is derived from the dates, never stored.
 * No ids are shown: a price book is identified by its name and date.
 */
export default function PriceBooksTab(): React.JSX.Element {
  const { t } = useTranslation('msp/billing-settings');
  const { formatDate } = useFormatters();
  const [books, setBooks] = React.useState<PriceBookSummary[]>([]);
  const [importOpen, setImportOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState<{ kind: 'withdraw' | 'discard'; book: PriceBookSummary } | null>(null);
  const [reactivate, setReactivate] = React.useState<{ book: PriceBookSummary; name: string; date: Date; preview: MakeActiveAgainPreview | null } | null>(null);

  const load = React.useCallback(async () => {
    const result = await listPriceBooksAction();
    if (Array.isArray(result)) setBooks(result);
    else handleError(result);
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const download = async (book: PriceBookSummary) => {
    const result = await downloadPriceBookCsvAction(book.price_book_id);
    if ('csv' in result) {
      const url = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = result.fileName; link.click();
      URL.revokeObjectURL(url);
    } else handleError(result);
  };

  const openReactivate = async (book: PriceBookSummary) => {
    const date = new Date();
    setReactivate({ book, name: `${book.name} (re-activated ${iso(date)})`, date, preview: null });
    const preview = await previewMakePriceBookActiveAgainAction(book.price_book_id, iso(date));
    if ('impact' in preview) setReactivate((current) => current && { ...current, preview });
  };
  const refreshReactivatePreview = async (date: Date) => {
    if (!reactivate) return;
    setReactivate({ ...reactivate, date, preview: null });
    const preview = await previewMakePriceBookActiveAgainAction(reactivate.book.price_book_id, iso(date));
    if ('impact' in preview) setReactivate((current) => current && { ...current, preview });
  };
  const confirmReactivate = async () => {
    if (!reactivate) return;
    const result = await makePriceBookActiveAgainAction(reactivate.book.price_book_id, { name: reactivate.name, effectiveDate: iso(reactivate.date) });
    if ('priceBookId' in result) { toast.success(t('priceBooks.toast.reactivated', { defaultValue: 'Price book created.' })); setReactivate(null); await load(); }
    else handleError(result);
  };

  const runConfirmed = async () => {
    if (!confirm) return;
    const result = confirm.kind === 'withdraw' ? await withdrawPriceBookAction(confirm.book.price_book_id) : await discardPriceBookAction(confirm.book.price_book_id);
    if ('permissionError' in result || 'error' in result) handleError(result as never);
    else toast.success(confirm.kind === 'withdraw' ? t('priceBooks.toast.withdrawn', { defaultValue: 'Price book withdrawn.' }) : t('priceBooks.toast.discarded', { defaultValue: 'Draft discarded.' }));
    setConfirm(null);
    await load();
  };

  const columns: ColumnDefinition<PriceBookSummary>[] = [
    { title: t('priceBooks.columns.name', { defaultValue: 'Name' }), dataIndex: 'name' },
    { title: t('priceBooks.columns.effectiveDate', { defaultValue: 'Effective date' }), dataIndex: 'effective_date', render: (value: string) => formatDate(value) },
    {
      title: t('priceBooks.columns.status', { defaultValue: 'Status' }), dataIndex: 'displayStatus',
      render: (value: PriceBookDisplayStatus) => <Badge variant={STATUS_VARIANT[value]}>{t(`priceBooks.status.${value}`, { defaultValue: value })}</Badge>,
    },
    { title: t('priceBooks.columns.items', { defaultValue: 'Items' }), dataIndex: 'itemCount' },
    { title: t('priceBooks.columns.currencies', { defaultValue: 'Currencies' }), dataIndex: 'currencyCount' },
    { title: t('priceBooks.columns.appliedBy', { defaultValue: 'Applied by' }), dataIndex: 'appliedByName', render: (value: string | null) => value ?? '—' },
    { title: t('priceBooks.columns.appliedAt', { defaultValue: 'Applied' }), dataIndex: 'applied_at', render: (value: string | null) => value ? formatDate(value) : '—' },
    {
      title: '', dataIndex: 'price_book_id', id: 'actions', sortable: false, width: '3rem',
      render: (_: string, book: PriceBookSummary) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button id={`price-book-actions-${book.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} variant="ghost" className="h-8 w-8 p-0" aria-label={t('priceBooks.actions.menu', { defaultValue: 'Price book actions' })}><MoreVertical className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {book.displayStatus !== 'draft' && <DropdownMenuItem id="price-book-download" onClick={() => download(book)}>{t('priceBooks.actions.download', { defaultValue: 'Download' })}</DropdownMenuItem>}
            {(book.displayStatus === 'superseded' || book.displayStatus === 'active') && <DropdownMenuItem id="price-book-make-active-again" onClick={() => openReactivate(book)}>{t('priceBooks.actions.makeActiveAgain', { defaultValue: 'Make active again' })}</DropdownMenuItem>}
            {book.displayStatus === 'scheduled' && <DropdownMenuItem id="price-book-withdraw" onClick={() => setConfirm({ kind: 'withdraw', book })}>{t('priceBooks.actions.withdraw', { defaultValue: 'Withdraw' })}</DropdownMenuItem>}
            {book.displayStatus === 'draft' && <DropdownMenuItem id="price-book-discard" onClick={() => setConfirm({ kind: 'discard', book })}>{t('priceBooks.actions.discard', { defaultValue: 'Discard' })}</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">{t('priceBooks.description', { defaultValue: 'A price book is a named, dated set of catalog prices. The active one is the latest whose date has arrived.' })}</p>
        <Button id="price-book-new-from-csv" onClick={() => setImportOpen(true)}>{t('priceBooks.actions.newFromCsv', { defaultValue: 'New price book from CSV' })}</Button>
      </div>
      <DataTable id="price-books-table" data={books} columns={columns} pagination pageSize={10} />
      <PriceBookImportDialog isOpen={importOpen} onClose={() => setImportOpen(false)} onApplied={() => void load()} />

      <ConfirmationDialog
        id="price-book-confirm-dialog"
        isOpen={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirmed}
        title={confirm?.kind === 'withdraw' ? t('priceBooks.confirm.withdrawTitle', { defaultValue: 'Withdraw price book' }) : t('priceBooks.confirm.discardTitle', { defaultValue: 'Discard draft' })}
        message={confirm?.kind === 'withdraw'
          ? t('priceBooks.confirm.withdrawMessage', { defaultValue: 'Withdraw "{{name}}"? Its prices have not taken effect yet and will be removed.', name: confirm?.book.name })
          : t('priceBooks.confirm.discardMessage', { defaultValue: 'Discard the draft "{{name}}"?', name: confirm?.book.name })}
        confirmLabel={confirm?.kind === 'withdraw' ? t('priceBooks.actions.withdraw', { defaultValue: 'Withdraw' }) : t('priceBooks.actions.discard', { defaultValue: 'Discard' })}
      />

      <Dialog id="price-book-reactivate-dialog" isOpen={reactivate !== null} onClose={() => setReactivate(null)} title={t('priceBooks.reactivate.title', { defaultValue: 'Make price book active again' })}>
        {reactivate && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">{t('priceBooks.reactivate.help', { defaultValue: 'This creates a new price book with the rates of "{{name}}". The original is not changed.', name: reactivate.book.name })}</p>
            <div>
              <Label htmlFor="price-book-reactivate-name">{t('priceBooks.reactivate.name', { defaultValue: 'New price book name' })}</Label>
              <Input id="price-book-reactivate-name" value={reactivate.name} onChange={(event) => setReactivate({ ...reactivate, name: event.target.value })} />
            </div>
            <div>
              <Label htmlFor="price-book-reactivate-date">{t('priceBooks.reactivate.date', { defaultValue: 'Effective date' })}</Label>
              <DatePicker id="price-book-reactivate-date" value={reactivate.date} onChange={(date) => void refreshReactivatePreview(date)} minDate={new Date()} />
            </div>
            {reactivate.preview && (
              <p id="price-book-reactivate-impact" className="text-sm">
                {t('priceBooks.reactivate.impact', { defaultValue: '{{willChange}} contract lines will change, {{custom}} keep a custom price, {{unreviewed}} are not yet reviewed.', willChange: reactivate.preview.impact.willChange.length, custom: reactivate.preview.impact.custom.length, unreviewed: reactivate.preview.impact.unreviewed.length })}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button id="price-book-reactivate-cancel" variant="outline" onClick={() => setReactivate(null)}>{t('priceBooks.import.cancel', { defaultValue: 'Cancel' })}</Button>
              <Button id="price-book-reactivate-confirm" onClick={confirmReactivate} disabled={!reactivate.name.trim()}>{t('priceBooks.reactivate.confirm', { defaultValue: 'Create price book' })}</Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
