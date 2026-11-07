import { z } from 'zod';
import { CANCEL_REASONS, CALLER_CLOSE_REASONS } from './stateMachine';

/** Zod input schemas for the warranty actions (C5). Free text is trimmed; empty becomes null. */

export const RMA_TEXT_MAX = 255;
export const RMA_NOTE_MAX = 2000;

const uuid = z.string().uuid();

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, 'Not a real calendar date');

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    });

const requiredText = (max: number, message: string) => z.string().trim().min(1, message).max(max);

const common = {
  occurred_at: z.string().datetime().optional(),
  note: optionalText(RMA_NOTE_MAX),
};

export const WARRANTY_TRACKS = ['standard', 'advance_replacement'] as const;
export const warrantyTrackSchema = z.enum(WARRANTY_TRACKS);

export const openWarrantyClaimSchema = z.object({
  asset_id: uuid,
  reason: requiredText(RMA_NOTE_MAX, 'Describe what is wrong with the device'),
  vendor_id: uuid.nullish().transform((v) => v ?? null),
  rma_reference: optionalText(RMA_TEXT_MAX),
  /** Provisional until approval, which writes the final track. */
  rma_type: warrantyTrackSchema.default('standard'),
  /** Optional ticket the claim belongs to; the composition layer verifies access. When absent, the open custody episode's ticket is used. */
  ticket_id: uuid.nullish().transform((v) => v ?? null),
});
export type OpenWarrantyClaimInput = z.infer<typeof openWarrantyClaimSchema>;

export const approveWarrantyClaimSchema = z.object({
  track: warrantyTrackSchema,
  vendor_id: uuid,
  rma_reference: optionalText(RMA_TEXT_MAX),
  return_ship_to: optionalText(RMA_NOTE_MAX),
  return_by: calendarDate.nullish().transform((v) => v ?? null),
  ...common,
});
export type ApproveWarrantyClaimInput = z.infer<typeof approveWarrantyClaimSchema>;

export const denyWarrantyClaimSchema = z.object({
  denial_reason: requiredText(RMA_NOTE_MAX, 'Give the reason the claim is not covered'),
  ...common,
});
export type DenyWarrantyClaimInput = z.infer<typeof denyWarrantyClaimSchema>;

export const cancelWarrantyClaimSchema = z.object({
  reason: z.enum(CANCEL_REASONS),
  ...common,
});
export type CancelWarrantyClaimInput = z.infer<typeof cancelWarrantyClaimSchema>;

export const markDeviceReceivedSchema = z.object({ ...common });
export type MarkDeviceReceivedInput = z.infer<typeof markDeviceReceivedSchema>;

export const shipToVendorSchema = z.object({
  /** Falls back to the vendor already on the case. */
  vendor_id: uuid.nullish().transform((v) => v ?? null),
  carrier: requiredText(RMA_TEXT_MAX, 'Enter the carrier'),
  tracking_number: requiredText(RMA_TEXT_MAX, 'Enter the tracking number'),
  return_by: calendarDate,
  rma_reference: optionalText(RMA_TEXT_MAX),
  return_ship_to: optionalText(RMA_NOTE_MAX),
  ...common,
});
export type ShipToVendorInput = z.infer<typeof shipToVendorSchema>;

const inboundShipping = {
  inbound_carrier: optionalText(RMA_TEXT_MAX),
  inbound_tracking_number: optionalText(RMA_TEXT_MAX),
  /** Where the device lands when it is back in the office (C4 `received`). Required when custody is with the vendor. */
  location_id: uuid.nullish().transform((v) => v ?? null),
  bin: optionalText(64),
};

export const receiveVendorReplacementSchema = z.object({
  replacement_serial_number: requiredText(RMA_TEXT_MAX, 'Enter the replacement serial number'),
  model: optionalText(RMA_TEXT_MAX),
  manufacturer: optionalText(RMA_TEXT_MAX),
  warranty_end_date: calendarDate.nullish().transform((v) => v ?? null),
  ...inboundShipping,
  ...common,
});
export type ReceiveVendorReplacementInput = z.infer<typeof receiveVendorReplacementSchema>;

export const recordVendorRepairSchema = z.object({ ...inboundShipping, ...common });
export type RecordVendorRepairInput = z.infer<typeof recordVendorRepairSchema>;

export const recordVendorCreditSchema = z.object({ ...common });
export type RecordVendorCreditInput = z.infer<typeof recordVendorCreditSchema>;

export const returnDeviceToClientSchema = z.object({
  /** Who took it / how it went back, shown in custody history. */
  counterparty: optionalText(RMA_TEXT_MAX),
  ...common,
});
export type ReturnDeviceToClientInput = z.infer<typeof returnDeviceToClientSchema>;

export const closeWarrantyRmaSchema = z.object({
  /** Defaults to `vendor_credited` for a credited case, otherwise `resolved`. */
  reason: z.enum(CALLER_CLOSE_REASONS).optional(),
  ...common,
});
export type CloseWarrantyRmaInput = z.infer<typeof closeWarrantyRmaSchema>;
