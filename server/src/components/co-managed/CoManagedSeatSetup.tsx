'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { enableCoManagedSeatArrangementAction, getCoManagedSeatAdminOptions } from '@/lib/actions/coManagedSeatActions';
import CoManagedSeatContactField from './CoManagedSeatContactField';
import CoManagedSeatBoardPicker, { type SeatBoardChoice } from './CoManagedSeatBoardPicker';
import { coManagedSeatMessage } from './coManagedSeatMessage';
import { newCoManagedOperationId } from './coManagedOperationId';
import CoManagedPurchaseReview, { coManagedPurchaseErrorMessage } from './CoManagedPurchaseReview';
import { useCoManagedPurchaseController } from './useCoManagedPurchaseController';
import { decideCoManagedSeatResume, planCoManagedSeatPurchase } from './seatPurchaseResume';
import {
  clearSeatAllocationIntent, readSeatAllocationIntent, writeSeatAllocationIntent, type CoManagedSeatAllocationIntent,
} from './seatAllocationIntent';

/** Refusals that mean the pool was short when the command ran: the purchase path, not an error, when a purchase is offered. */
const SHORT_POOL_CODES = new Set(['CAPACITY_UNAVAILABLE', 'CO_MANAGED_POOL_LIMIT']);
const POLL_MS = 4000;
const POLL_LIMIT = 30;

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'review' }
  | { kind: 'waiting'; operationId: string | null; quantity: number | null; exhausted: boolean }
  | { kind: 'retry'; operationId: string; quantity: number };

/**
 * Seat shape setup: how many seats, which boards, and the first technician. Confirming calls one
 * server action, which reserves the seats, writes the arrangement, sets the board scope and sends the
 * invitation. The operation id is kept across submits so a repeat returns the same arrangement.
 */
export default function CoManagedSeatSetup({ clientId, idPrefix, available, purchaseOpen = false, onEnabled, onDirtyChange }: {
  clientId: string;
  idPrefix: string;
  available: number;
  /** The pool purchase is offered to this administrator: a larger request goes to the purchase review instead of being refused. */
  purchaseOpen?: boolean;
  onEnabled: () => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const [boards, setBoards] = useState<Array<{ boardId: string; name: string }>>([]);
  const [scope, setScope] = useState<SeatBoardChoice>({});
  const [seats, setSeats] = useState(1);
  const [contactId, setContactId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationId = useRef(newCoManagedOperationId());
  const firstRender = useRef(true);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  /** The request waiting on capacity; null when none is. Lives in storage too, so a reload picks it up. */
  const intent = useRef<CoManagedSeatAllocationIntent | null>(null);
  /** The recorded purchase was replayed and reported complete: only reconciliation is outstanding. */
  const settled = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const controller = useCoManagedPurchaseController({
    // Recorded before the purchase request leaves: the operation can be replayed, never restarted.
    onOperation: (operation) => {
      if (!intent.current) return;
      intent.current = { ...intent.current, purchase: operation };
      writeSeatAllocationIntent(intent.current);
    },
  });

  useEffect(() => {
    let cancelled = false;
    void getCoManagedSeatAdminOptions(clientId).then((options) => { if (!cancelled) setBoards(options.boards); })
      .catch(() => { if (!cancelled) setError(t('coManaged.seat.error.load', { defaultValue: 'Could not load the choices. Refresh and try again.' })); });
    return () => { cancelled = true; };
  }, [clientId, t]);

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    onDirtyChange?.(true);
  }, [seats, contactId, scope, onDirtyChange]);

  const valid = Number.isInteger(seats) && seats >= 1 && (purchaseOpen || seats <= available) && contactId !== '';
  const boardChoices = () => Object.entries(scope).map(([boardId, entry]) => ({ boardId, canCreate: entry.canCreate }));

  /** Runs the allocation. The operation id makes a replay return the same arrangement, whoever completes it. */
  const complete = async (request: { operationId: string; seats: number; contactId: string; boards: Array<{ boardId: string; canCreate: boolean }> }) => {
    const result = await enableCoManagedSeatArrangementAction({ clientId, ...request });
    if ('rejected' in result) {
      if (purchaseOpen && SHORT_POOL_CODES.has(result.errorCode) && !intent.current) return 'short' as const;
      intent.current = null; clearSeatAllocationIntent(clientId);
      setPhase({ kind: 'idle' });
      setError(coManagedSeatMessage(result.errorCode, t));
      return 'rejected' as const;
    }
    // The arrangement exists: whatever a later step said, the panel is where it is finished.
    intent.current = null; clearSeatAllocationIntent(clientId);
    setPhase({ kind: 'idle' });
    onDirtyChange?.(false);
    operationId.current = newCoManagedOperationId();
    await onEnabled();
    return 'done' as const;
  };

  const completeRef = useRef(complete);
  completeRef.current = complete;

  /**
   * Moves the pending intent one step, from capacity alone: complete when the pool covers it, otherwise
   * wait on, retry, replay or (only when no purchase exists for it) offer the review for the new total.
   */
  const advance = useCallback(async (): Promise<void> => {
    const pending = intent.current;
    if (!pending) return;
    setPhase((current) => current.kind === 'waiting' ? current : { kind: 'checking' });
    try {
      const state = await controller.reload();
      if (!alive.current || !intent.current) return;
      if (!state) { setPhase({ kind: 'idle' }); setError(coManagedSeatMessage('CAPACITY_UNAVAILABLE', t)); return; }
      const decision = decideCoManagedSeatResume({
        requested: pending.seats, capacity: { purchased: state.capacity, available: state.available },
        pending: state.purchase.pending, intentPurchase: intent.current.purchase, settled: settled.current,
      });
      switch (decision.kind) {
        case 'complete': await completeRef.current({ operationId: pending.operationId, seats: pending.seats, contactId: pending.contactId, boards: pending.boards }); return;
        case 'review':
          if (await controller.review(decision.quantity)) setPhase({ kind: 'review' }); else setPhase({ kind: 'idle' });
          return;
        case 'retry': setPhase({ kind: 'retry', operationId: decision.operationId, quantity: decision.quantity }); return;
        case 'waiting': setPhase((current) => ({ kind: 'waiting', operationId: decision.operationId, quantity: decision.quantity, exhausted: current.kind === 'waiting' && current.exhausted })); return;
        case 'reconcile': {
          const outcome = await controller.replay(decision.operationId, decision.quantity);
          if (!alive.current || !intent.current) return;
          if (outcome === 'updated') { settled.current = true; await advance(); return; }
          if (outcome === 'expired') {
            intent.current = { ...intent.current, purchase: null }; writeSeatAllocationIntent(intent.current);
            await advance(); return;
          }
          setPhase({ kind: 'waiting', operationId: decision.operationId, quantity: decision.quantity, exhausted: false });
          return;
        }
      }
    } catch {
      if (alive.current) { setPhase({ kind: 'idle' }); setError(t('coManaged.seat.purchase.error', { defaultValue: 'The pool could not be checked. Refresh and try again; nothing is charged twice.' })); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller.reload, controller.replay, controller.review, clientId, t, purchaseOpen]);

  // The effects below must not restart when a callback's identity changes, so they call through refs.
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  // A request interrupted by a reload or a return from checkout resumes here, from the stored intent.
  useEffect(() => {
    if (!purchaseOpen) return;
    const stored = readSeatAllocationIntent(clientId);
    if (!stored) return;
    intent.current = stored; settled.current = false;
    operationId.current = stored.operationId;
    setSeats(stored.seats); setContactId(stored.contactId);
    setScope(Object.fromEntries(stored.boards.map((board) => [board.boardId, { canCreate: board.canCreate }])));
    void advanceRef.current();
  }, [clientId, purchaseOpen]);

  // Waiting on reconciliation: re-read capacity on a bounded timer. Reading never purchases.
  const waiting = phase.kind === 'waiting';
  useEffect(() => {
    if (!waiting) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (attempts > POLL_LIMIT) {
        clearInterval(timer);
        setPhase((current) => current.kind === 'waiting' ? { ...current, exhausted: true } : current);
        return;
      }
      void advanceRef.current();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting]);

  const submit = async () => {
    if (!valid || busy) return;
    controller.clearPreviewProblem();
    setBusy(true); setError(null);
    try {
      const request = { operationId: operationId.current, seats, contactId, boards: boardChoices() };
      const plan = planCoManagedSeatPurchase(seats, { purchased: 0, available });
      let outcome: 'done' | 'rejected' | 'short' = 'short';
      // Short capacity never reaches the command: the request is kept, the pool reviewed, the allocation finished after.
      if (!(purchaseOpen && plan.short)) outcome = await complete(request);
      if (outcome === 'short') {
        intent.current = { clientId, ...request, purchase: null, savedAt: Date.now() }; settled.current = false;
        writeSeatAllocationIntent(intent.current);
        await advance();
      }
    } catch {
      setError(t('coManaged.seat.error.submit', { defaultValue: 'The request may not have finished. Try again; it will not be applied twice.' }));
    } finally { setBusy(false); }
  };

  const handleResume = async (target: { operationId: string | null; quantity: number | null }) => {
    if (!target.operationId || !target.quantity) return;
    // The same operation, by id: the server answers from it, so a resume cannot be a second charge.
    const outcome = await controller.replay(target.operationId, target.quantity);
    if (outcome === 'updated') { settled.current = true; await advance(); }
  };

  const cancelPending = () => {
    intent.current = null; settled.current = false; clearSeatAllocationIntent(clientId);
    controller.clearPreviewProblem();
    controller.setPreview(null);
    setPhase({ kind: 'idle' });
  };
  const purchaseMessage = coManagedPurchaseErrorMessage(controller.error, t);
  const pendingPurchaseBusy = busy || controller.busy;

  return (
    <form id={`${idPrefix}-seat-setup`} className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {error && <Alert variant="destructive"><AlertDescription id={`${idPrefix}-seat-error`}>{error}</AlertDescription></Alert>}
      {purchaseMessage && (phase.kind !== 'idle' || controller.previewProblem !== null) && <Alert variant="destructive"><AlertDescription id={`${idPrefix}-purchase-error`}>{purchaseMessage}</AlertDescription></Alert>}
      {phase.kind !== 'idle' && intent.current && (
        <div id={`${idPrefix}-seat-purchase`} role="status" className="space-y-2 rounded-md border border-[rgb(var(--color-border-200))] p-3 text-sm">
          <p>{phase.kind === 'waiting'
            ? (phase.exhausted
              ? t('coManaged.seat.purchase.stalled', { defaultValue: 'The new seats have not appeared yet. Check again shortly; you will not be charged twice.' })
              : t('coManaged.seat.purchase.waiting', { defaultValue: 'Waiting for the purchase to complete. {{count}} seats will be allocated as soon as the pool has them.', count: intent.current.seats }))
            : phase.kind === 'retry'
              ? t('coManaged.seat.purchase.failed', { defaultValue: 'Payment did not go through. Retry the same purchase to allocate {{count}} seats.', count: intent.current.seats })
              : phase.kind === 'review'
                ? t('coManaged.seat.purchase.review', { defaultValue: 'The pool has too few seats. Review the purchase to allocate {{count}} seats.', count: intent.current.seats })
                : t('coManaged.seat.purchase.checking', { defaultValue: 'Checking the pool…' })}</p>
          <div className="flex flex-wrap gap-2">
            {phase.kind === 'waiting' && (
              <Button id={`${idPrefix}-seat-purchase-check`} type="button" variant="outline" disabled={pendingPurchaseBusy} onClick={() => void advance()}>
                {t('coManaged.seat.purchase.check', { defaultValue: 'Check again' })}
              </Button>
            )}
            {(phase.kind === 'retry' || (phase.kind === 'waiting' && phase.operationId && phase.quantity)) && (
              <Button id={`${idPrefix}-seat-purchase-resume`} type="button" disabled={pendingPurchaseBusy}
                onClick={() => { if (phase.kind === 'retry' || phase.operationId) void handleResume(phase); }}>
                {t('coManaged.resumePurchase', { defaultValue: 'Resume purchase' })}
              </Button>
            )}
            {phase.kind === 'review' && (
              <Button id={`${idPrefix}-seat-purchase-reopen`} type="button" disabled={pendingPurchaseBusy} onClick={() => void advance()}>
                {t('coManaged.reviewPurchase', { defaultValue: 'Review purchase' })}
              </Button>
            )}
            <Button id={`${idPrefix}-seat-purchase-cancel`} type="button" variant="outline" disabled={pendingPurchaseBusy} onClick={cancelPending}>
              {t('coManaged.seat.purchase.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </div>
        </div>
      )}
      <fieldset disabled={busy || phase.kind !== 'idle'} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-seat-count`}>{t('coManaged.seat.setup.seats', { defaultValue: 'Number of seats' })}</Label>
          <Input id={`${idPrefix}-seat-count`} type="number" required min={1} max={purchaseOpen ? undefined : Math.max(1, available)} step={1} value={seats}
            onChange={(event) => setSeats(Number(event.target.value))} />
        </div>
        <div className="space-y-2">
          <Label>{t('coManaged.seat.setup.boards', { defaultValue: 'Boards in scope' })}</Label>
          <p className="text-sm text-muted-foreground">{t('coManaged.seat.setup.boardsHint', { defaultValue: 'Technicians see tickets of their company on these boards only.' })}</p>
          <CoManagedSeatBoardPicker idPrefix={idPrefix} boards={boards} value={scope} onChange={setScope} />
        </div>
        <div className="space-y-2">
          <Label>{t('coManaged.seat.setup.technician', { defaultValue: 'First technician' })}</Label>
          <p className="text-sm text-muted-foreground">{t('coManaged.seat.setup.technicianHint', { defaultValue: 'Choose one of this client\'s contacts. They are invited by email.' })}</p>
          <CoManagedSeatContactField clientId={clientId} idPrefix={idPrefix} value={contactId} onChange={setContactId} disabled={busy} />
        </div>
      </fieldset>
      <Button id={`${idPrefix}-seat-submit`} type="submit" disabled={busy || !valid || phase.kind !== 'idle'}>
        {t('coManaged.seat.setup.submit', { defaultValue: 'Enable seats' })}
      </Button>
      {purchaseOpen && <CoManagedPurchaseReview controller={controller} idPrefix={idPrefix} onConfirmed={async (outcome) => {
        if (outcome === 'updated') { settled.current = true; await advance(); return; }
        if (outcome === 'expired' && intent.current) {
          // The session ended unpaid: the operation is spent, so the next review starts a fresh one for the same total.
          intent.current = { ...intent.current, purchase: null }; writeSeatAllocationIntent(intent.current);
          await advance();
        }
      }} />}
    </form>
  );
}
