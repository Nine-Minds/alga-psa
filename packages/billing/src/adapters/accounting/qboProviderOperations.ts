/* eslint-disable custom-rules/no-feature-to-feature-imports -- Accounting provider-operations bridge lives with the adapter that owns the provider client */
import { AppError } from '@alga-psa/core';
import {
  AccountingProviderOperations,
  ProviderCreditApplicationRequest,
  ProviderCreditApplicationResult,
  ProviderDocumentSnapshot,
  ProviderPaymentRequest,
  ProviderPaymentResult,
  ProviderVoidDocumentRequest
} from '@alga-psa/types';
import { QboClientService } from '@alga-psa/integrations/lib/qbo/qboClientService';

/** QBO PaymentRefNum is limited to 21 characters. */
const QBO_PAYMENT_REF_MAX = 21;

function truncateRef(ref: string): string {
  return ref.length > QBO_PAYMENT_REF_MAX ? ref.slice(0, QBO_PAYMENT_REF_MAX) : ref;
}

function toCents(value: unknown): number | undefined {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : undefined;
}

/**
 * QBO implementation of the provider-neutral outbound operations. This is the
 * only place a QBO client is constructed for shared sync paths — the appliers
 * dispatch through `providerOperations()` instead.
 */
export async function createQboProviderOperations(
  tenantId: string,
  targetRealm: string
): Promise<AccountingProviderOperations> {
  const client = await QboClientService.create(tenantId, targetRealm);

  return {
    async readDocument(entityType: string, externalId: string): Promise<ProviderDocumentSnapshot | null> {
      const entity = await client.read<Record<string, unknown>>(entityType, externalId);
      if (!entity) {
        return null;
      }
      return {
        externalId,
        externalEntityType: entityType,
        syncToken: entity.SyncToken !== undefined ? String(entity.SyncToken) : null,
        totalAmount: entity.TotalAmt !== undefined ? Number(entity.TotalAmt) : null,
        docNumber: typeof entity.DocNumber === 'string' ? entity.DocNumber : null,
        customerExternalId:
          entity.CustomerRef && typeof entity.CustomerRef === 'object'
            ? String((entity.CustomerRef as Record<string, unknown>).value ?? '') || null
            : null
      };
    },

    async getCreditRemainingCents(externalCreditNoteId: string): Promise<number | null> {
      const creditMemo = await client.read<Record<string, unknown>>('CreditMemo', externalCreditNoteId);
      if (!creditMemo) {
        return null;
      }
      const remainingDollars = Number(creditMemo.Balance);
      return Number.isFinite(remainingDollars) ? Math.round(remainingDollars * 100) : null;
    },

    async recordPayment(request: ProviderPaymentRequest): Promise<ProviderPaymentResult> {
      const amountDollars = Math.round(request.amountCents) / 100;
      const payload: Record<string, unknown> = {
        CustomerRef: request.externalCustomerId ? { value: request.externalCustomerId } : undefined,
        TotalAmt: amountDollars,
        PaymentRefNum: truncateRef(request.reference),
        PrivateNote: `Alga payment ${request.reference}`,
        Line: [
          {
            Amount: amountDollars,
            LinkedTxn: [{ TxnId: request.externalInvoiceId, TxnType: 'Invoice' }]
          }
        ]
      };
      if (request.depositAccountRef?.value) {
        payload.DepositToAccountRef = { value: request.depositAccountRef.value };
      }

      const created = await client.create<Record<string, any>>('Payment', payload);
      const entity = created?.Id ? created : created?.payment;
      const externalPaymentId = String(entity?.Id ?? entity?.payment?.Id ?? '');
      if (!externalPaymentId) {
        throw new AppError('QBO_PAYMENT_MISSING_ID', 'QBO Payment response missing Id');
      }
      const unapplied = entity?.UnappliedAmt;
      return {
        externalPaymentId,
        syncToken: entity?.SyncToken !== undefined ? String(entity.SyncToken) : undefined,
        unappliedCents: toCents(unapplied)
      };
    },

    async applyCredit(request: ProviderCreditApplicationRequest): Promise<ProviderCreditApplicationResult> {
      const amountDollars = Math.round(request.amountCents) / 100;
      const paymentPayload = {
        CustomerRef: request.externalCustomerId ? { value: request.externalCustomerId } : undefined,
        TotalAmt: 0,
        Line: [
          {
            Amount: amountDollars,
            LinkedTxn: [{ TxnId: request.externalInvoiceId, TxnType: 'Invoice' }]
          },
          {
            Amount: amountDollars,
            LinkedTxn: [{ TxnId: request.externalCreditNoteId, TxnType: 'CreditMemo' }]
          }
        ],
        PrivateNote: 'Credit application from Alga'
      };

      const created = await client.create<Record<string, any>>('Payment', paymentPayload);
      const entity = created?.Id ? created : created?.payment;
      const externalPaymentId = String(entity?.Id ?? entity?.payment?.Id ?? '');
      if (!externalPaymentId) {
        throw new AppError('QBO_PAYMENT_MISSING_ID', 'QBO Payment response missing Id');
      }
      return {
        externalPaymentId,
        syncToken: entity?.SyncToken !== undefined ? String(entity.SyncToken) : undefined
      };
    },

    async voidDocument(request: ProviderVoidDocumentRequest): Promise<void> {
      const externalEntityType = request.externalEntityType ?? 'Invoice';
      const entity = await client.read<Record<string, unknown>>(externalEntityType, request.externalId);
      if (!entity) {
        return; // Already gone in QBO — treat as voided.
      }
      const syncToken = String(entity.SyncToken ?? entity.syncToken ?? '0');
      if (externalEntityType === 'CreditMemo') {
        await client.deleteCreditMemo(request.externalId, syncToken);
      } else {
        await client.voidInvoice(request.externalId, syncToken);
      }
    }
  };
}
