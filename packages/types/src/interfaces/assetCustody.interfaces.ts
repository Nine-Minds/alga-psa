/**
 * Equipment custody for client-owned devices (alga-2026-0002683, card C4).
 * Design of record: ee/docs/plans/2026-10-20-physical-work-tags/design-C4-equipment-custody.md
 *
 * Custody is a property of an asset: one `asset_custody` row per stay at the MSP (an episode), plus an
 * append-only `asset_custody_events` chain. It is never stock: nothing here references inventory.
 */

export const ASSET_OWNERSHIPS = ['client', 'msp'] as const;
export type AssetOwnership = (typeof ASSET_OWNERSHIPS)[number];

export const CUSTODY_STATES = ['in_office', 'with_vendor', 'closed'] as const;
export type CustodyState = (typeof CUSTODY_STATES)[number];

export const CUSTODY_PURPOSES = ['repair', 'warranty_evaluation', 'loaner_prep', 'staging'] as const;
export type CustodyPurpose = (typeof CUSTODY_PURPOSES)[number];

export const CUSTODY_NEXT_ACTION_PARTIES = ['msp', 'client', 'vendor'] as const;
export type CustodyNextActionParty = (typeof CUSTODY_NEXT_ACTION_PARTIES)[number];

export const CUSTODY_CLOSE_REASONS = ['returned_to_client', 'disposed', 'transferred_to_rma'] as const;
export type CustodyCloseReason = (typeof CUSTODY_CLOSE_REASONS)[number];

export const CUSTODY_EVENT_TYPES = ['received', 'moved', 'handed_off', 'shipped', 'returned'] as const;
export type CustodyEventType = (typeof CUSTODY_EVENT_TYPES)[number];

/** Status slug given to assets created by intake. Custody itself never depends on it. */
export const HELD_BY_MSP_STATUS = 'held_by_msp';

export interface CustodyAccessory {
  label: string;
  quantity: number;
}

export interface IAssetCustody {
  custody_id: string;
  asset_id: string;
  client_id: string;
  ticket_id: string | null;
  state: CustodyState;
  purpose: CustodyPurpose;
  holder_user_id: string | null;
  location_id: string | null;
  bin: string | null;
  next_action_party: CustodyNextActionParty;
  /** Internal only. Never printed on a label, never shown to the client portal. */
  next_action_note: string | null;
  /** Calendar date, `YYYY-MM-DD`. */
  follow_up_on: string | null;
  condition_note: string | null;
  accessories: CustodyAccessory[];
  opened_at: string;
  opened_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  close_reason: CustodyCloseReason | null;
  created_at: string;
  updated_at: string;
}

/** An episode with its display joins (names), for the asset card, chips and queue. */
export interface IAssetCustodyDetail extends IAssetCustody {
  location_name: string | null;
  holder_name: string | null;
  ticket_number: string | null;
}

export interface IAssetCustodyEvent {
  event_id: string;
  custody_id: string;
  asset_id: string;
  event_type: CustodyEventType;
  occurred_at: string;
  recorded_at: string;
  actor_user_id: string | null;
  from_location_id: string | null;
  from_bin: string | null;
  to_location_id: string | null;
  to_bin: string | null;
  from_holder_user_id: string | null;
  to_holder_user_id: string | null;
  counterparty: string | null;
  note: string | null;
  document_ids: string[];
}

export interface IAssetCustodyEventDetail extends IAssetCustodyEvent {
  from_location_name: string | null;
  to_location_name: string | null;
  actor_name: string | null;
  from_holder_name: string | null;
  to_holder_name: string | null;
}

export const CUSTODY_QUEUE_TABS = [
  'all_open',
  'in_office',
  'waiting_on_vendor',
  'waiting_on_client',
  'overdue',
] as const;
export type CustodyQueueTab = (typeof CUSTODY_QUEUE_TABS)[number];

export interface ICustodyQueueFilters {
  tab?: CustodyQueueTab;
  client_id?: string;
  location_id?: string;
  holder_user_id?: string;
  purpose?: CustodyPurpose;
  next_action_party?: CustodyNextActionParty;
  /** Only episodes held by the caller. */
  mine?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ICustodyQueueRow extends IAssetCustodyDetail {
  asset_tag: string | null;
  asset_name: string | null;
  client_name: string | null;
  days_held: number;
}

export interface ICustodyQueuePage {
  rows: ICustodyQueueRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Counts per preset tab over the caller's readable episodes (filters other than `tab` applied). */
  tabCounts: Record<CustodyQueueTab, number>;
}

/** Location choices for intake pickers. Deliberately only id, name and type (see D5). */
export interface ICustodyLocationOption {
  location_id: string;
  name: string;
  location_type: string;
  is_default: boolean;
}
