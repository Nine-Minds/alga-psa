'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Pencil } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { toast } from 'react-hot-toast';
import { currencyFractionDigits, toMinorUnits } from '@alga-psa/core';
import type { IProjectPhase, ProjectBillingInvoiceMode } from '@alga-psa/types';
import type { ProjectBillingOverview } from '../../actions/projectBillingConfigActions';
import { updateProjectBillingConfig } from '../../actions/projectBillingConfigActions';
import { generateProjectInvoice } from '../../actions/invoiceGeneration';
import { useDrawer } from '@alga-psa/ui';
import InvoicePreviewDrawerContent from '../billing-dashboard/invoicing/InvoicePreviewDrawerContent';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import BillingSetupWizard from './BillingSetupWizard';
import ScheduleTable from './ScheduleTable';
import CapPanel from './CapPanel';
import PhaseRateOverridesEditor from './PhaseRateOverridesEditor';
import BudgetVsActualCard from './BudgetVsActualCard';
import DeliveryEconomicsCard from './DeliveryEconomicsCard';
import { formatCents } from './billingViewHelpers';

interface ProjectBillingViewProps {
  projectId: string;
  clientId: string | null;
  phases: IProjectPhase[];
  overview: ProjectBillingOverview | null;
  loading: boolean;
  canManage: boolean;
  /** Schedule entry to highlight after a phase-completion deep link (F139). */
  highlightEntryId?: string | null;
  onChanged: () => void;
}

/**
 * Orchestrates the project billing view (option 3). No config → setup wizard;
 * fixed-price → schedule table + terms editor; T&M → cap panel + rate overrides;
 * both models get the budget-vs-actual and delivery-economics cards.
 */
export default function ProjectBillingView({
  projectId,
  clientId,
  phases,
  overview,
  loading,
  canManage,
  highlightEntryId,
  onChanged,
}: ProjectBillingViewProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const { openDrawer } = useDrawer();
  const [editingTerms, setEditingTerms] = useState(false);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);

  if (loading || !overview) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-[rgb(var(--color-text-500))]">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('billing.loading', 'Loading billing...')}
      </div>
    );
  }

  const { config, entries, rollup, cap_usage, economics, overrides } = overview;

  if (!config) {
    return (
      <BillingSetupWizard
        projectId={projectId}
        clientId={clientId}
        canManage={canManage}
        onEnabled={onChanged}
      />
    );
  }

  const isFixed = config.billing_model === 'fixed_price';

  const openInvoice = (invoiceId: string) => {
    openDrawer(
      <InvoicePreviewDrawerContent invoiceId={invoiceId} />,
      undefined,
      undefined,
      '1100px',
    );
  };

  const handleGenerateTmInvoice = async () => {
    setGeneratingInvoice(true);
    try {
      const result = await generateProjectInvoice(projectId);
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('billing.tm.invoiceGenerated', 'Project invoice generated'));
      onChanged();
      openInvoice(result.invoice_id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setGeneratingInvoice(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 pb-4">
      {isFixed ? (
        <>
          <div className="flex items-center justify-between">
            <div className="text-sm text-[rgb(var(--color-text-600))]">
              {t('billing.terms.fixed', '{{total}} fixed price · {{mode}} invoicing', {
                total: formatCents(config.total_price, config.currency),
                mode: config.invoice_mode === 'standalone'
                  ? t('billing.mode.standalone', 'standalone')
                  : t('billing.mode.recurring', 'recurring'),
              })}
            </div>
            {canManage && (
              <Button id="billing-edit-terms" variant="ghost" size="xs" onClick={() => setEditingTerms(true)}>
                <Pencil className="mr-1 h-3.5 w-3.5" />
                {t('billing.terms.edit', 'Edit terms')}
              </Button>
            )}
          </div>
          <ScheduleTable
            config={config}
            entries={entries}
            rollup={rollup}
            phases={phases}
            canManage={canManage}
            highlightEntryId={highlightEntryId}
            onChanged={onChanged}
            onOpenInvoice={(invoiceId) => openInvoice(invoiceId)}
          />
        </>
      ) : (
        <>
          {config.invoice_mode === 'standalone' && canManage && (
            <div className="flex justify-end">
              <Button
                id="billing-generate-tm-invoice"
                onClick={handleGenerateTmInvoice}
                disabled={generatingInvoice}
              >
                {generatingInvoice && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {generatingInvoice
                  ? t('billing.tm.generatingInvoice', 'Generating invoice...')
                  : t('billing.tm.generateInvoice', 'Generate project invoice')}
              </Button>
            </div>
          )}
          <CapPanel config={config} canManage={canManage} onChanged={onChanged} />
          <PhaseRateOverridesEditor
            overrides={overrides}
            phases={phases}
            currency={config.currency}
            canManage={canManage}
            onChanged={onChanged}
          />
        </>
      )}

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <BudgetVsActualCard config={config} rollup={rollup} capUsage={cap_usage} />
        <DeliveryEconomicsCard economics={economics} currency={config.currency} billingModel={config.billing_model} />
      </div>

      {editingTerms && isFixed && (
        <TermsDialog
          configId={config.config_id}
          currency={config.currency}
          totalPrice={config.total_price}
          invoiceMode={config.invoice_mode}
          onClose={() => setEditingTerms(false)}
          onSaved={() => { setEditingTerms(false); onChanged(); }}
        />
      )}
    </div>
  );
}

interface TermsDialogProps {
  configId: string;
  currency: string | null;
  totalPrice: number | null;
  invoiceMode: ProjectBillingInvoiceMode;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * F127 — fixed-price terms editor. Editing the total re-validates the schedule
 * server-side; the billing model is immutable once an entry is invoiced. Both
 * failures come back as structured results, surfaced here as a clear toast.
 */
function TermsDialog({ configId, currency, totalPrice, invoiceMode, onClose, onSaved }: TermsDialogProps) {
  const { t, i18n } = useTranslation(['features/projects', 'common']);
  const digits = currencyFractionDigits(currency ?? 'USD');
  const [totalText, setTotalText] = useState(totalPrice != null ? (totalPrice / Math.pow(10, digits)).toString() : '');
  const [mode, setMode] = useState<ProjectBillingInvoiceMode>(invoiceMode);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const major = Number(totalText);
    if (!Number.isFinite(major) || major <= 0) {
      toast.error(t('billing.setup.errorTotal', 'Enter a total price greater than zero'));
      return;
    }
    setSaving(true);
    try {
      const result = await updateProjectBillingConfig(configId, {
        total_price: toMinorUnits(major, i18n.language, currency ?? 'USD'),
        invoice_mode: mode,
      });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('billing.terms.saved', 'Billing terms updated'));
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog isOpen onClose={onClose} id="billing-terms-dialog" title={t('billing.terms.dialogTitle', 'Edit billing terms')}>
      <DialogContent>
        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="billing-terms-total">
              {t('billing.setup.total', 'Total price')} ({currency ?? 'USD'})
            </Label>
            <Input
              id="billing-terms-total"
              type="number"
              min="0"
              step="0.01"
              value={totalText}
              onChange={(e) => setTotalText(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="billing-terms-mode">{t('billing.setup.invoiceMode', 'Invoicing')}</Label>
            <CustomSelect
              id="billing-terms-mode"
              value={mode}
              onValueChange={(v) => setMode(v as ProjectBillingInvoiceMode)}
              options={[
                { value: 'standalone', label: t('billing.setup.standalone', 'Standalone project invoices') },
                { value: 'recurring', label: t('billing.setup.recurring', "Roll into client's recurring invoice") },
              ]}
            />
          </div>
        </div>
      </DialogContent>
      <DialogFooter>
        <Button id="billing-terms-cancel" variant="outline" onClick={onClose} disabled={saving}>
          {t('common:actions.cancel', 'Cancel')}
        </Button>
        <Button id="billing-terms-save" onClick={handleSave} disabled={saving}>
          {saving ? t('billing.entry.saving', 'Saving...') : t('common:actions.save', 'Save')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
