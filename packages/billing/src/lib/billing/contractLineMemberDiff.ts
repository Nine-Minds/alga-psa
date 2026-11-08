// Pure: plans the writes for one existing contract-line member by comparing the
// editor's draft with the values the editor was showing (the stored values, or
// the values effective at the edit boundary for unit-priced Fixed and Usage
// members). Only fields the user actually changed produce a write, so an
// untouched member never schedules a revision or replaces one that already
// exists at the boundary. Defaults mirror the editor's own initialisation.
import type { IContractLineServiceRateTier } from '@alga-psa/types';
import { resolveFixedMemberRatePair } from '@shared/billingClients/fixedMemberRate';
import type { ContractLineEditMemberDraft } from '../../actions/contractLineSaveAction';

export interface MemberCurrentState {
  baseConfig: { quantity?: number | null; custom_rate?: number | null };
  typeConfig: Record<string, any> | null;
  rateTiers?: Array<Pick<IContractLineServiceRateTier, 'min_quantity' | 'max_quantity' | 'rate'>>;
}

export interface MemberStoredFixed {
  pricing_basis: string | null;
  base_rate_basis: 'per_unit' | 'share' | null;
}

export interface MemberWritePlan {
  base: Record<string, unknown>;
  type: Record<string, unknown>;
  rateTiers?: IContractLineServiceRateTier[];
}

const num = (v: unknown): number | null => (v === undefined || v === null ? null : Number(v));
const same = (a: unknown, b: unknown) => num(a) === num(b);
const tiersKey = (tiers: ReadonlyArray<{ min_quantity?: unknown; max_quantity?: unknown; rate?: unknown }>) =>
  JSON.stringify(tiers.map((t) => [num(t.min_quantity), num(t.max_quantity), num(t.rate)]));

export function planExistingMemberWrite(params: {
  configurationType: string;
  member: ContractLineEditMemberDraft;
  current: MemberCurrentState;
  storedFixed?: MemberStoredFixed;
}): MemberWritePlan | null {
  const { configurationType, member, current, storedFixed } = params;
  const base: Record<string, unknown> = {};
  const type: Record<string, unknown> = {};
  const quantityChanged = member.quantity !== undefined && !same(member.quantity, current.baseConfig.quantity ?? 1);
  const customRateChanged = member.custom_rate !== undefined && !same(member.custom_rate, current.baseConfig.custom_rate);

  if (configurationType === 'Hourly') {
    if (quantityChanged) base.quantity = member.quantity;
    if (customRateChanged) base.custom_rate = member.custom_rate;
    if (member.hourly_rate !== undefined && !same(member.hourly_rate, current.typeConfig?.hourly_rate)) {
      type.hourly_rate = member.hourly_rate;
    }
  } else if (configurationType === 'Fixed') {
    if (quantityChanged) base.quantity = member.quantity;
    if (customRateChanged) base.custom_rate = member.custom_rate;
    if (member.base_rate !== undefined && !same(member.base_rate, current.typeConfig?.base_rate)) {
      // The edit keeps what the stored number means (share vs per unit); a rate
      // on a member that had none is a unit price. A null rate is the catalog
      // price and carries no basis. Derived here, never sent by the client.
      Object.assign(type, resolveFixedMemberRatePair({
        base_rate: member.base_rate,
        base_rate_basis: storedFixed?.base_rate_basis ?? 'per_unit',
        pricing_basis: storedFixed?.pricing_basis,
      }));
    }
  } else if (configurationType === 'Usage') {
    const t = current.typeConfig ?? {};
    const shownRate = current.baseConfig.custom_rate ?? t.base_rate;
    const tiersChanged = member.rateTiers !== undefined
      && tiersKey(member.rateTiers) !== tiersKey(current.rateTiers ?? []);
    const changed =
      (member.base_rate !== undefined && !same(member.base_rate, shownRate)) ||
      (member.measurement_mode != null && member.measurement_mode !== (t.measurement_mode ?? 'additive')) ||
      (member.minimum_usage !== undefined && !same(member.minimum_usage, t.minimum_usage ?? 0)) ||
      (member.enable_tiered_pricing !== undefined && Boolean(member.enable_tiered_pricing) !== Boolean(t.enable_tiered_pricing)) ||
      (member.unit_of_measure !== undefined && member.unit_of_measure !== t.unit_of_measure) ||
      tiersChanged;
    if (!changed) return null;
    // setUsageMeasurementModeInTransaction owns the effective-period transition
    // and stores a complete snapshot, so a changed Usage member sends its full state.
    base.custom_rate = member.base_rate;
    type.measurement_mode = member.measurement_mode;
    type.minimum_usage = member.minimum_usage;
    type.enable_tiered_pricing = member.enable_tiered_pricing;
    if (member.base_rate !== undefined) type.base_rate = member.base_rate;
    if (member.unit_of_measure !== undefined) type.unit_of_measure = member.unit_of_measure;
    return { base, type, rateTiers: member.rateTiers };
  } else {
    return null;
  }
  if (Object.keys(base).length === 0 && Object.keys(type).length === 0) return null;
  return { base, type };
}
