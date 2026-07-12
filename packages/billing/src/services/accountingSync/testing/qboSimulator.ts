/**
 * In-memory QuickBooks Online simulator for sync-engine tests.
 *
 * Implements the subset of QBO behavior our integration actually depends on,
 * at the QboClientService seam, so tests can exercise real sequences (export →
 * edit → CDC poll → apply) against stateful QBO semantics instead of canned
 * one-shot mocks. Wire it in with:
 *
 *   vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
 *     QboClientService: { create: async () => sim.client },
 *     getDefaultQboRealmId: async () => 'realm-sim'
 *   }));
 *
 * Modeled semantics (each is something a test has caught or could catch):
 * - Ids and SyncTokens: tokens start at "0" and increment on every update;
 *   updates with a stale token are rejected (QBO error 5010).
 * - Customer DisplayName uniqueness across ACTIVE AND INACTIVE customers
 *   (QBO error 6240) — while name queries return active customers only,
 *   mirroring QBO's default query filter. This asymmetry is exactly what makes
 *   auto-provisioning against a 26-year-old company file dangerous.
 * - Invoice/CreditMemo totals are computed by "QBO" from the lines — the
 *   caller's header TotalAmt is ignored, like QBO itself does. An optional
 *   taxAdjustmentCents models Automated Sales Tax changing the total at
 *   create time.
 * - Payments carry Line[].LinkedTxn allocations and reduce Invoice/CreditMemo
 *   balances; a zero-dollar payment linking CreditMemo → Invoice is the
 *   canonical credit application.
 * - autoApplyCredits models QBO's SalesFormsPrefs.AutoApplyCredit: when on,
 *   creating an invoice immediately consumes any open customer credit via an
 *   auto-created Payment (the race our credit applier must survive).
 * - Change Data Capture: every mutation is journaled with a deterministic
 *   logical clock; fetchChanges(since) replays entity state like QBO CDC.
 */

export interface QboSimEntity {
  Id: string;
  SyncToken: string;
  [key: string]: any;
}

export interface QboSimulatorOptions {
  /** Model QBO's "Automatically apply credits" company preference. */
  autoApplyCredits?: boolean;
  /** Cents "QBO" adds to each created invoice total (models AST recalculating tax). */
  taxAdjustmentCents?: number;
  /** Realm id reported in change sets. */
  realmId?: string;
}

interface ChangeJournalEntry {
  entityType: string;
  externalId: string;
  deleted: boolean;
  at: string;
}

export class QboSimError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'QboSimError';
  }
}

const SUPPORTED_ENTITIES = ['Customer', 'Invoice', 'CreditMemo', 'Payment'] as const;
type SimEntityType = (typeof SUPPORTED_ENTITIES)[number];

function toCents(amount: unknown): number {
  const value = Number(amount);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

function toAmount(cents: number): number {
  return Math.round(cents) / 100;
}

export class QboSimulator {
  private readonly stores: Record<SimEntityType, Map<string, QboSimEntity>> = {
    Customer: new Map(),
    Invoice: new Map(),
    CreditMemo: new Map(),
    Payment: new Map()
  };

  private journal: ChangeJournalEntry[] = [];
  private nextId = 1;
  /** Deterministic logical clock: every mutation advances one second. */
  private clockMs = Date.parse('2026-01-01T00:00:00.000Z');

  readonly options: QboSimulatorOptions;

  /** Drop-in facade matching QboClientService's public surface. */
  readonly client: {
    create: <T = any>(entityType: string, data: any) => Promise<T>;
    read: <T = any>(entityType: string, id: string) => Promise<T | null>;
    update: <T = any>(entityType: string, data: { Id: string; SyncToken: string; [key: string]: any }) => Promise<T>;
    query: <T = any>(selectQuery: string) => Promise<T[]>;
    fetchChanges: (since: string) => Promise<{
      changes: Array<{ entityType: string; externalId: string; syncToken?: string; deleted: boolean; payload: any }>;
      truncated: boolean;
      fetchedAt: string;
    }>;
    getPreferences: <T = any>() => Promise<T>;
    findCustomerByDisplayName: (displayName: string) => Promise<{ externalId: string; name: string; syncToken: string } | null>;
    createOrUpdateCustomer: (payload: { name: string; primaryEmail?: string | null }) => Promise<{ externalId: string; name: string }>;
    voidInvoice: (id: string, syncToken: string) => Promise<any>;
    deleteCreditMemo: (id: string, syncToken: string) => Promise<any>;
  };

  constructor(options: QboSimulatorOptions = {}) {
    this.options = { realmId: 'realm-sim', ...options };

    this.client = {
      create: async (entityType, data) => this.createEntity(entityType, data) as any,
      read: async (entityType, id) => (this.getStore(entityType).get(id) as any) ?? null,
      update: async (entityType, data) => this.updateEntity(entityType, data) as any,
      query: async (selectQuery) => this.runQuery(selectQuery) as any,
      fetchChanges: async (since) => this.fetchChanges(since),
      getPreferences: async () =>
        ({
          SalesFormsPrefs: {
            AutoApplyCredit: Boolean(this.options.autoApplyCredits),
            CustomTxnNumbers: true
          }
        }) as any,
      findCustomerByDisplayName: async (displayName) => {
        const found = this.findActiveCustomerByName(displayName);
        return found ? { externalId: found.Id, name: found.DisplayName, syncToken: found.SyncToken } : null;
      },
      createOrUpdateCustomer: async (payload) => {
        const existing = this.findActiveCustomerByName(payload.name);
        if (existing) {
          return { externalId: existing.Id, name: existing.DisplayName };
        }
        const created = this.createEntity('Customer', {
          DisplayName: payload.name,
          PrimaryEmailAddr: payload.primaryEmail ? { Address: payload.primaryEmail } : undefined
        });
        return { externalId: created.Id, name: created.DisplayName };
      },
      voidInvoice: async (id, syncToken) => this.voidInvoice(id, syncToken),
      deleteCreditMemo: async (id, syncToken) => this.deleteEntity('CreditMemo', id, syncToken)
    };
  }

  // ── Time & journal ────────────────────────────────────────────────────────

  /** Current simulator time; use as the `since` cursor between test phases. */
  now(): string {
    return new Date(this.clockMs).toISOString();
  }

  private tick(): string {
    this.clockMs += 1000;
    return this.now();
  }

  private journalChange(entityType: string, externalId: string, deleted = false): void {
    this.journal.push({ entityType, externalId, deleted, at: this.tick() });
  }

  // ── Entity CRUD with QBO semantics ────────────────────────────────────────

  private getStore(entityType: string): Map<string, QboSimEntity> {
    const store = this.stores[entityType as SimEntityType];
    if (!store) {
      throw new QboSimError('SIM_UNSUPPORTED', `QboSimulator does not model entity type ${entityType}`);
    }
    return store;
  }

  private allocateId(entityType: SimEntityType): string {
    return `${entityType.toLowerCase()}-${this.nextId++}`;
  }

  private assertFreshToken(entity: QboSimEntity, syncToken: string): void {
    if (entity.SyncToken !== String(syncToken)) {
      throw new QboSimError(
        '5010',
        `Stale Object Error: You and ${entity.Id} were working on this at the same time — supplied SyncToken ${syncToken}, current ${entity.SyncToken}`
      );
    }
  }

  private createEntity(entityType: string, data: any): QboSimEntity {
    const type = entityType as SimEntityType;
    switch (type) {
      case 'Customer':
        return this.createCustomer(data);
      case 'Invoice':
        return this.createTransactionDocument('Invoice', data);
      case 'CreditMemo':
        return this.createTransactionDocument('CreditMemo', data);
      case 'Payment':
        return this.createPayment(data);
      default:
        throw new QboSimError('SIM_UNSUPPORTED', `QboSimulator cannot create entity type ${entityType}`);
    }
  }

  private createCustomer(data: any): QboSimEntity {
    const displayName = String(data.DisplayName ?? '').trim();
    if (!displayName) {
      throw new QboSimError('2020', 'Required parameter DisplayName is missing');
    }
    // QBO enforces name uniqueness across active AND inactive customers.
    for (const customer of this.stores.Customer.values()) {
      if (customer.DisplayName === displayName) {
        throw new QboSimError(
          '6240',
          `Duplicate Name Exists Error: The name supplied (${displayName}) already exists`
        );
      }
    }
    const entity: QboSimEntity = {
      Id: this.allocateId('Customer'),
      SyncToken: '0',
      DisplayName: displayName,
      Active: data.Active !== false,
      ...(data.PrimaryEmailAddr ? { PrimaryEmailAddr: data.PrimaryEmailAddr } : {})
    };
    this.stores.Customer.set(entity.Id, entity);
    this.journalChange('Customer', entity.Id);
    return entity;
  }

  private sumSalesLines(lines: any[]): number {
    return (Array.isArray(lines) ? lines : [])
      .filter((line) => line?.DetailType !== 'SubTotalLineDetail')
      .reduce((sum, line) => sum + toCents(line?.Amount), 0);
  }

  private createTransactionDocument(type: 'Invoice' | 'CreditMemo', data: any): QboSimEntity {
    const lines = Array.isArray(data.Line) ? data.Line : [];
    // QBO computes the total from lines; the caller's TotalAmt is not trusted.
    const totalCents = this.sumSalesLines(lines) + (type === 'Invoice' ? (this.options.taxAdjustmentCents ?? 0) : 0);
    const entity: QboSimEntity = {
      Id: this.allocateId(type),
      SyncToken: '0',
      ...data,
      Line: lines,
      TotalAmt: toAmount(totalCents),
      Balance: toAmount(totalCents),
      TxnDate: data.TxnDate ?? this.now().slice(0, 10)
    };
    this.getStore(type).set(entity.Id, entity);
    this.journalChange(type, entity.Id);

    if (type === 'Invoice' && this.options.autoApplyCredits) {
      this.autoApplyOpenCredits(entity);
    }
    return entity;
  }

  private createPayment(data: any): QboSimEntity {
    const lines = Array.isArray(data.Line) ? data.Line : [];
    for (const line of lines) {
      const linked = Array.isArray(line?.LinkedTxn) ? line.LinkedTxn : [];
      for (const txn of linked) {
        this.applyPaymentAllocation(String(txn?.TxnType), String(txn?.TxnId), toCents(line?.Amount));
      }
    }
    const entity: QboSimEntity = {
      Id: this.allocateId('Payment'),
      SyncToken: '0',
      ...data,
      Line: lines,
      TotalAmt: Number(data.TotalAmt ?? 0),
      TxnDate: data.TxnDate ?? this.now().slice(0, 10)
    };
    this.stores.Payment.set(entity.Id, entity);
    this.journalChange('Payment', entity.Id);
    return entity;
  }

  private applyPaymentAllocation(txnType: string, txnId: string, amountCents: number): void {
    if (txnType !== 'Invoice' && txnType !== 'CreditMemo') {
      return;
    }
    const target = this.getStore(txnType).get(txnId);
    if (!target) {
      throw new QboSimError('610', `Object Not Found: ${txnType} ${txnId}`);
    }
    const remaining = toCents(target.Balance) - amountCents;
    if (remaining < 0) {
      throw new QboSimError(
        '6210',
        `Amount received (${toAmount(amountCents)}) exceeds open balance on ${txnType} ${txnId}`
      );
    }
    target.Balance = toAmount(remaining);
    // Balance movement bumps the token and journals a change, like real QBO.
    target.SyncToken = String(Number(target.SyncToken) + 1);
    this.journalChange(txnType, target.Id);
  }

  /** QBO's AutoApplyCredit: consume open customer credit against a new invoice. */
  private autoApplyOpenCredits(invoice: QboSimEntity): void {
    const customerId = invoice.CustomerRef?.value;
    if (!customerId) {
      return;
    }
    for (const cm of this.stores.CreditMemo.values()) {
      if (cm.deleted || cm.CustomerRef?.value !== customerId) {
        continue;
      }
      const cmBalance = toCents(cm.Balance);
      const invoiceBalance = toCents(invoice.Balance);
      if (cmBalance <= 0 || invoiceBalance <= 0) {
        continue;
      }
      const applied = Math.min(cmBalance, invoiceBalance);
      this.createPayment({
        CustomerRef: { value: customerId },
        TotalAmt: 0,
        PrivateNote: 'Automatically applied credit',
        Line: [
          { Amount: toAmount(applied), LinkedTxn: [{ TxnType: 'Invoice', TxnId: invoice.Id }] },
          { Amount: toAmount(applied), LinkedTxn: [{ TxnType: 'CreditMemo', TxnId: cm.Id }] }
        ]
      });
    }
  }

  private updateEntity(entityType: string, data: { Id: string; SyncToken: string; [key: string]: any }): QboSimEntity {
    const store = this.getStore(entityType);
    const entity = store.get(String(data.Id));
    if (!entity || entity.deleted) {
      throw new QboSimError('610', `Object Not Found: ${entityType} ${data.Id}`);
    }
    this.assertFreshToken(entity, data.SyncToken);

    const { Id: _id, SyncToken: _token, ...sparse } = data;
    Object.assign(entity, sparse);
    if (sparse.Line && (entityType === 'Invoice' || entityType === 'CreditMemo')) {
      const totalCents = this.sumSalesLines(sparse.Line);
      entity.TotalAmt = toAmount(totalCents);
      // Sparse updates reset the open balance like QBO recalculating the doc.
      entity.Balance = toAmount(totalCents);
    }
    entity.SyncToken = String(Number(entity.SyncToken) + 1);
    this.journalChange(entityType, entity.Id);
    return entity;
  }

  private voidInvoice(id: string, syncToken: string): QboSimEntity {
    const entity = this.stores.Invoice.get(id);
    if (!entity || entity.deleted) {
      throw new QboSimError('610', `Object Not Found: Invoice ${id}`);
    }
    this.assertFreshToken(entity, syncToken);
    // QBO voids keep the document with zeroed amounts and a "Voided" note.
    entity.TotalAmt = 0;
    entity.Balance = 0;
    entity.PrivateNote = entity.PrivateNote ? `${entity.PrivateNote} Voided` : 'Voided';
    entity.SyncToken = String(Number(entity.SyncToken) + 1);
    this.journalChange('Invoice', entity.Id);
    return entity;
  }

  private deleteEntity(entityType: string, id: string, syncToken: string): { Id: string; status: string } {
    const store = this.getStore(entityType);
    const entity = store.get(id);
    if (!entity || entity.deleted) {
      throw new QboSimError('610', `Object Not Found: ${entityType} ${id}`);
    }
    this.assertFreshToken(entity, syncToken);
    entity.deleted = true;
    this.journalChange(entityType, entity.Id, true);
    return { Id: id, status: 'Deleted' };
  }

  // ── Query & CDC ───────────────────────────────────────────────────────────

  private findActiveCustomerByName(displayName: string): QboSimEntity | null {
    for (const customer of this.stores.Customer.values()) {
      if (customer.Active && customer.DisplayName === displayName) {
        return customer;
      }
    }
    return null;
  }

  private runQuery(selectQuery: string): any[] {
    // Support the one query shape the integration issues. Anything else is a
    // loud failure so a new query gets modeled deliberately, not silently.
    const customerByName = selectQuery.match(/FROM\s+Customer\s+WHERE\s+DisplayName\s*=\s*'((?:[^']|'')*)'/i);
    if (customerByName) {
      const name = customerByName[1].replace(/''/g, "'");
      // QBO queries return ACTIVE rows only unless Active is filtered explicitly.
      const found = this.findActiveCustomerByName(name);
      return found ? [{ ...found }] : [];
    }
    throw new QboSimError('SIM_UNSUPPORTED', `QboSimulator does not model query: ${selectQuery}`);
  }

  private fetchChanges(since: string) {
    const sinceMs = Date.parse(since);
    // Latest journal entry per entity wins, replayed in change order.
    const latest = new Map<string, ChangeJournalEntry>();
    for (const entry of this.journal) {
      if (Date.parse(entry.at) > sinceMs) {
        latest.set(`${entry.entityType}:${entry.externalId}`, entry);
      }
    }
    const changes = Array.from(latest.values())
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((entry) => {
        const entity = this.getStore(entry.entityType).get(entry.externalId);
        return {
          entityType: entry.entityType,
          externalId: entry.externalId,
          syncToken: entity?.SyncToken,
          deleted: entry.deleted,
          payload: entry.deleted ? {} : { ...entity }
        };
      });
    return { changes, truncated: false, fetchedAt: this.tick() };
  }

  // ── Test seeding helpers ──────────────────────────────────────────────────

  seedCustomer(params: { name: string; active?: boolean }): QboSimEntity {
    const entity = this.createCustomer({ DisplayName: params.name, Active: params.active !== false });
    if (params.active === false) {
      entity.Active = false;
    }
    return entity;
  }

  seedInvoice(params: { customerId: string; amountCents: number; docNumber?: string }): QboSimEntity {
    return this.createEntity('Invoice', {
      CustomerRef: { value: params.customerId },
      DocNumber: params.docNumber,
      Line: [
        {
          DetailType: 'SalesItemLineDetail',
          Amount: toAmount(params.amountCents),
          SalesItemLineDetail: { ItemRef: { value: 'item-sim' } }
        }
      ]
    });
  }

  seedCreditMemo(params: { customerId: string; amountCents: number; docNumber?: string }): QboSimEntity {
    return this.createEntity('CreditMemo', {
      CustomerRef: { value: params.customerId },
      DocNumber: params.docNumber,
      Line: [
        {
          DetailType: 'SalesItemLineDetail',
          Amount: toAmount(params.amountCents),
          SalesItemLineDetail: { ItemRef: { value: 'item-sim' } }
        }
      ]
    });
  }

  /** A bookkeeper (or QBO auto-apply) applying credit to an invoice inside QBO. */
  applyCreditInQbo(params: { creditMemoId: string; invoiceId: string; amountCents: number }): QboSimEntity {
    const cm = this.stores.CreditMemo.get(params.creditMemoId);
    const invoice = this.stores.Invoice.get(params.invoiceId);
    if (!cm || !invoice) {
      throw new QboSimError('610', 'Object Not Found: credit application target');
    }
    return this.createPayment({
      CustomerRef: invoice.CustomerRef,
      TotalAmt: 0,
      Line: [
        { Amount: toAmount(params.amountCents), LinkedTxn: [{ TxnType: 'Invoice', TxnId: params.invoiceId }] },
        { Amount: toAmount(params.amountCents), LinkedTxn: [{ TxnType: 'CreditMemo', TxnId: params.creditMemoId }] }
      ]
    });
  }

  /** A customer payment (check, card) received against an invoice inside QBO. */
  receivePaymentInQbo(params: {
    invoiceId: string;
    amountCents: number;
    referenceNumber?: string;
    txnDate?: string;
  }): QboSimEntity {
    const invoice = this.stores.Invoice.get(params.invoiceId);
    if (!invoice) {
      throw new QboSimError('610', `Object Not Found: Invoice ${params.invoiceId}`);
    }
    return this.createPayment({
      CustomerRef: invoice.CustomerRef,
      TotalAmt: toAmount(params.amountCents),
      PaymentRefNum: params.referenceNumber,
      TxnDate: params.txnDate,
      Line: [
        { Amount: toAmount(params.amountCents), LinkedTxn: [{ TxnType: 'Invoice', TxnId: params.invoiceId }] }
      ]
    });
  }

  entities(entityType: string): QboSimEntity[] {
    return Array.from(this.getStore(entityType).values());
  }
}
