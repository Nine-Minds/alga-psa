import { z } from 'zod';
import {
  CUSTODY_EVENT_TYPES,
  CUSTODY_NEXT_ACTION_PARTIES,
  CUSTODY_PURPOSES,
  CUSTODY_QUEUE_TABS,
} from '@alga-psa/types';

/** Zod schemas for equipment custody (alga-2026-0002683, C4). Design: D2, D5, D7. */

export const CUSTODY_BIN_MAX_LENGTH = 64;
export const CUSTODY_NOTE_MAX_LENGTH = 2000;

const uuid = z.string().guid();

/** Calendar date, `YYYY-MM-DD`, and a real one (no 2026-02-31). */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, 'Not a real calendar date');

/** Free text: trimmed; empty becomes null so "clear this" and "not given" are distinguishable by key presence. */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    });

export const custodyBinSchema = z
  .string()
  .nullish()
  .transform((value) => value?.trim() || null)
  .refine((value) => value === null || value.length <= CUSTODY_BIN_MAX_LENGTH, `Bin is at most ${CUSTODY_BIN_MAX_LENGTH} characters`);

export const custodyAccessorySchema = z.object({
  label: z.string().trim().min(1).max(120),
  quantity: z.number().int().min(1).max(999),
});

export const custodyPurposeSchema = z.enum(CUSTODY_PURPOSES);
export const custodyNextActionPartySchema = z.enum(CUSTODY_NEXT_ACTION_PARTIES);

const detailFields = {
  purpose: custodyPurposeSchema,
  location_id: uuid,
  bin: custodyBinSchema,
  holder_user_id: uuid.optional(),
  next_action_party: custodyNextActionPartySchema.default('msp'),
  next_action_note: optionalText(CUSTODY_NOTE_MAX_LENGTH),
  follow_up_on: calendarDateSchema.nullish().transform((v) => v ?? null),
  condition_note: optionalText(CUSTODY_NOTE_MAX_LENGTH),
  accessories: z.array(custodyAccessorySchema).max(50).default([]),
  /** Photo document ids already uploaded for this step. */
  document_ids: z.array(uuid).max(20).default([]),
};

/** Open an episode on an existing asset (asset detail "Receive into custody", C5/C6 callers). */
export const openCustodyInputSchema = z.object({
  asset_id: uuid,
  ticket_id: uuid.nullish().transform((v) => v ?? null),
  ...detailFields,
  occurred_at: z.string().datetime().optional(),
  note: optionalText(CUSTODY_NOTE_MAX_LENGTH),
});
export type OpenCustodyInput = z.infer<typeof openCustodyInputSchema>;

/** Minimal client asset created by intake. Always `client` ownership and `held_by_msp` status. */
export const intakeNewAssetSchema = z.object({
  name: z.string().trim().min(1).max(255),
  asset_type: z.string().trim().min(1).default('unknown'),
  manufacturer: optionalText(255),
  model: optionalText(255),
  serial_number: optionalText(255),
  asset_tag: optionalText(255),
});
export type IntakeNewAsset = z.infer<typeof intakeNewAssetSchema>;

export const receiveEquipmentInputSchema = z
  .object({
    ticket_id: uuid,
    asset_id: uuid.optional(),
    new_asset: intakeNewAssetSchema.optional(),
    ...detailFields,
    occurred_at: z.string().datetime().optional(),
    note: optionalText(CUSTODY_NOTE_MAX_LENGTH),
  })
  .refine((v) => Boolean(v.asset_id) !== Boolean(v.new_asset), {
    message: 'Provide either an existing asset or a new item, not both',
    path: ['asset_id'],
  });
export type ReceiveEquipmentInput = z.infer<typeof receiveEquipmentInputSchema>;

const eventCommon = {
  occurred_at: z.string().datetime().optional(),
  note: optionalText(CUSTODY_NOTE_MAX_LENGTH),
  document_ids: z.array(uuid).max(20).default([]),
};

export const custodyEventInputSchema = z.discriminatedUnion('event_type', [
  z.object({
    event_type: z.literal('moved'),
    location_id: uuid.optional(),
    bin: custodyBinSchema.optional(),
    ...eventCommon,
  }),
  z.object({ event_type: z.literal('handed_off'), to_holder_user_id: uuid, ...eventCommon }),
  z.object({
    event_type: z.literal('shipped'),
    counterparty: z.string().trim().min(1).max(255),
    ...eventCommon,
  }),
  z.object({
    event_type: z.literal('received'),
    location_id: uuid,
    bin: custodyBinSchema,
    holder_user_id: uuid.optional(),
    ...eventCommon,
  }),
  z.object({
    event_type: z.literal('returned'),
    counterparty: optionalText(255),
    ...eventCommon,
  }),
]);
export type CustodyEventInput = z.infer<typeof custodyEventInputSchema>;

/** Non-physical edits: they update the episode and write a `custody_updated` history row, never an event. */
export const updateCustodyPatchSchema = z
  .object({
    purpose: custodyPurposeSchema,
    next_action_party: custodyNextActionPartySchema,
    next_action_note: optionalText(CUSTODY_NOTE_MAX_LENGTH),
    follow_up_on: calendarDateSchema.nullable(),
    condition_note: optionalText(CUSTODY_NOTE_MAX_LENGTH),
    accessories: z.array(custodyAccessorySchema).max(50),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateCustodyPatch = z.infer<typeof updateCustodyPatchSchema>;

export const custodyQueueFiltersSchema = z.object({
  tab: z.enum(CUSTODY_QUEUE_TABS).optional(),
  client_id: uuid.optional(),
  location_id: uuid.optional(),
  holder_user_id: uuid.optional(),
  purpose: custodyPurposeSchema.optional(),
  next_action_party: custodyNextActionPartySchema.optional(),
  mine: z.boolean().optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(200).optional(),
});

export { CUSTODY_EVENT_TYPES };
