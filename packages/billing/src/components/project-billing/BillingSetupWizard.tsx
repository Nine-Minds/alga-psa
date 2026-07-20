'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Receipt } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { toMinorUnits } from '@alga-psa/core';
import type {
  ProjectBillingDepositTreatment,
  ProjectBillingInvoiceMode,
  ProjectBillingModel,
} from '@alga-psa/types';
import { createProjectBillingConfig } from '../../actions/projectBillingConfigActions';
import { getContractsWithClients } from '../../actions/contractActions';
import { resolveClientBillingCurrency } from '../../actions/billingCurrencyActions';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

interface BillingSetupWizardProps {
  projectId: string;
  clientId: string | null;
  canManage: boolean;
  onEnabled: () => void;
}

const NO_CONTRACT = '__none__';

/**
 * F116 — enable-billing setup. Shown in the billing view when a project has no
 * config: a quiet empty state that opens a compact dialog to pick the model,
 * price or cap, invoice mode, and an optional contract link. Currency is resolved
 * server-side from the client, so it is not collected here.
 */
export default function BillingSetupWizard({ projectId, clientId, canManage, onEnabled }: BillingSetupWizardProps) {
  const { t, i18n } = useTranslation(['features/projects', 'common']);
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<ProjectBillingModel>('fixed_price');
  const [totalText, setTotalText] = useState('');
  const [invoiceMode, setInvoiceMode] = useState<ProjectBillingInvoiceMode>('standalone');
  const [depositTreatment, setDepositTreatment] = useState<ProjectBillingDepositTreatment>('credit');
  const [capText, setCapText] = useState('');
  const [thresholdsText, setThresholdsText] = useState('75, 90, 100');
  const [contractId, setContractId] = useState(NO_CONTRACT);
  const [contracts, setContracts] = useState<{ value: string; label: string }[]>([]);
  const [currency, setCurrency] = useState('USD');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !clientId) return;
    let cancelled = false;
    Promise.all([getContractsWithClients(), resolveClientBillingCurrency(clientId)])
      .then(([res, resolvedCurrency]) => {
        if (cancelled || !Array.isArray(res)) return;
        setContracts(
          res
            .filter((contract) => contract.client_id === clientId)
            .map((contract) => ({ value: contract.contract_id, label: contract.contract_name })),
        );
        if (typeof resolvedCurrency === 'string') setCurrency(resolvedCurrency);
      })
      .catch(() => { if (!cancelled) setContracts([]); });
    return () => { cancelled = true; };
  }, [open, clientId]);

  const handleCreate = async () => {
    let totalPrice: number | undefined;
    let capAmount: number | undefined;
    let thresholds: number[] | undefined;

    if (model === 'fixed_price') {
      const major = Number(totalText);
      if (!Number.isFinite(major) || major <= 0) {
        toast.error(t('billing.setup.errorTotal', 'Enter a total price greater than zero'));
        return;
      }
      totalPrice = toMinorUnits(major, i18n.language, currency);
    } else if (capText.trim() !== '') {
      const major = Number(capText);
      if (!Number.isFinite(major) || major <= 0) {
        toast.error(t('billing.setup.errorCap', 'Enter a cap greater than zero'));
        return;
      }
      capAmount = toMinorUnits(major, i18n.language, currency);
      thresholds = thresholdsText
        .split(',')
        .map((token) => Number(token.trim()))
        .filter((value) => Number.isFinite(value) && value > 0 && value <= 100)
        .sort((a, b) => a - b);
    }

    setSaving(true);
    try {
      const result = await createProjectBillingConfig({
        project_id: projectId,
        billing_model: model,
        total_price: totalPrice,
        invoice_mode: invoiceMode,
        contract_id: contractId === NO_CONTRACT ? null : contractId,
        cap_amount: capAmount ?? null,
        cap_behavior: model === 'time_and_materials' && capAmount != null ? 'hard_cap' : undefined,
        cap_notify_thresholds: thresholds,
        deposit_treatment: model === 'fixed_price' ? depositTreatment : undefined,
      });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('billing.setup.enabled', 'Project billing enabled'));
      setOpen(false);
      onEnabled();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card id="project-billing-setup" className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-600 dark:bg-primary-900/20">
        <Receipt className="h-5 w-5" />
      </span>
      <div>
        <h3 className="text-base font-bold text-[rgb(var(--color-text-900))]">{t('billing.setup.title', 'Bill this project')}</h3>
        <p className="mt-1 max-w-md text-sm text-[rgb(var(--color-text-500))]">
          {t('billing.setup.subtitle', 'Sell this project as a fixed price with a milestone schedule, or time & materials with an optional budget cap.')}
        </p>
      </div>
      {canManage ? (
        <Button id="billing-setup-open" onClick={() => setOpen(true)}>
          {t('billing.setup.enable', 'Enable billing')}
        </Button>
      ) : (
        <p className="text-xs text-[rgb(var(--color-text-400))]">{t('billing.setup.noPermission', 'Billing is not configured for this project.')}</p>
      )}

      {open && (
        <Dialog isOpen onClose={() => setOpen(false)} id="billing-setup-dialog" title={t('billing.setup.dialogTitle', 'Enable project billing')}>
          <DialogContent>
            <div className="flex flex-col gap-4 text-left">
              <div>
                <Label htmlFor="billing-setup-model">{t('billing.setup.model', 'Billing model')}</Label>
                <CustomSelect
                  id="billing-setup-model"
                  value={model}
                  onValueChange={(v) => setModel(v as ProjectBillingModel)}
                  options={[
                    { value: 'fixed_price', label: t('billing.setup.fixed', 'Fixed price') },
                    { value: 'time_and_materials', label: t('billing.setup.tm', 'Time & materials') },
                  ]}
                />
              </div>

              {model === 'fixed_price' ? (
                <>
                  <div>
                    <Label htmlFor="billing-setup-total">{t('billing.setup.total', 'Total price')}</Label>
                    <Input
                      id="billing-setup-total"
                      type="number"
                      min="0"
                      step="0.01"
                      value={totalText}
                      onChange={(e) => setTotalText(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <Label htmlFor="billing-setup-deposit">{t('billing.setup.deposit', 'Deposit treatment')}</Label>
                    <CustomSelect
                      id="billing-setup-deposit"
                      value={depositTreatment}
                      onValueChange={(v) => setDepositTreatment(v as ProjectBillingDepositTreatment)}
                      options={[
                        { value: 'credit', label: t('billing.setup.depositCredit', 'Apply as credit') },
                        { value: 'deduct_final', label: t('billing.setup.depositDeduct', 'Deduct from final') },
                      ]}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label htmlFor="billing-setup-cap">{t('billing.setup.cap', 'Budget cap (optional)')}</Label>
                    <Input
                      id="billing-setup-cap"
                      type="number"
                      min="0"
                      step="0.01"
                      value={capText}
                      onChange={(e) => setCapText(e.target.value)}
                      placeholder={t('billing.setup.noCap', 'No cap')}
                    />
                  </div>
                  {capText.trim() !== '' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-md border border-[rgb(var(--color-border-200))] px-3 py-2">
                        <p className="text-xs font-semibold text-[rgb(var(--color-text-700))]">
                          {t('billing.cap.hard', 'Hard cap (write down)')}
                        </p>
                        <p className="mt-1 text-[11px] text-[rgb(var(--color-text-500))]">
                          {t('billing.cap.hardHint', 'Labor and materials beyond the cap are written down automatically.')}
                        </p>
                      </div>
                      <div>
                        <Label htmlFor="billing-setup-thresholds">{t('billing.cap.thresholds', 'Notify at (%)')}</Label>
                        <Input
                          id="billing-setup-thresholds"
                          value={thresholdsText}
                          onChange={(e) => setThresholdsText(e.target.value)}
                          placeholder="75, 90, 100"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}

              <div>
                <Label htmlFor="billing-setup-invoice-mode">{t('billing.setup.invoiceMode', 'Invoicing')}</Label>
                <CustomSelect
                  id="billing-setup-invoice-mode"
                  value={invoiceMode}
                  onValueChange={(v) => setInvoiceMode(v as ProjectBillingInvoiceMode)}
                  options={[
                    { value: 'standalone', label: t('billing.setup.standalone', 'Standalone project invoices') },
                    { value: 'recurring', label: t('billing.setup.recurring', "Roll into client's recurring invoice") },
                  ]}
                />
              </div>

              <div>
                <Label htmlFor="billing-setup-contract">{t('billing.setup.contract', 'Link a contract (optional)')}</Label>
                <CustomSelect
                  id="billing-setup-contract"
                  value={contractId}
                  onValueChange={setContractId}
                  options={[{ value: NO_CONTRACT, label: t('billing.setup.noContract', 'No contract') }, ...contracts]}
                />
              </div>
            </div>
          </DialogContent>
          <DialogFooter>
            <Button id="billing-setup-cancel" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              {t('common:actions.cancel', 'Cancel')}
            </Button>
            <Button id="billing-setup-create" onClick={handleCreate} disabled={saving}>
              {saving ? t('billing.setup.enabling', 'Enabling...') : t('billing.setup.enable', 'Enable billing')}
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </Card>
  );
}
