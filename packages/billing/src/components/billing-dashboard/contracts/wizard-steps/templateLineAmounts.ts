import type {
  ClientTemplateLineEditInput,
  ClientTemplateLinesView,
} from '@alga-psa/billing/actions/contractWizardActions';

type LineView = ClientTemplateLinesView['lines'][number];
type ServiceView = LineView['services'][number];
type FieldView = LineView['base_rate'];

export type TemplateAmountFieldKind =
  | 'line_base_rate'
  | 'line_overtime_rate'
  | 'member_rate'
  | 'member_overtime_rate'
  | 'bucket_overage_rate'
  | 'legacy_bucket_overage_rate';

/** One amount field of the template view together with where its edit lives. */
export interface TemplateAmountFieldRef {
  kind: TemplateAmountFieldKind;
  line: LineView;
  service?: ServiceView;
  poolId?: string;
  poolName?: string | null;
  field: FieldView;
}

/** Every amount field of the view, in display order. */
export function listTemplateAmountFields(view: ClientTemplateLinesView): TemplateAmountFieldRef[] {
  const out: TemplateAmountFieldRef[] = [];
  for (const line of view.lines) {
    out.push({ kind: 'line_base_rate', line, field: line.base_rate });
    out.push({ kind: 'line_overtime_rate', line, field: line.overtime_rate });
    for (const service of line.services) {
      out.push({ kind: 'member_rate', line, service, field: service.rate });
      out.push({ kind: 'member_overtime_rate', line, service, field: service.overtime_rate });
      out.push({ kind: 'legacy_bucket_overage_rate', line, service, field: service.bucket_overage_rate });
    }
    for (const pool of line.bucket_pools) {
      out.push({
        kind: 'bucket_overage_rate',
        line,
        poolId: pool.template_bucket_id,
        poolName: pool.name,
        field: pool.overage_rate,
      });
    }
  }
  return out;
}

/** The wizard edit for a field: `undefined` = untouched, `null` = cleared, number = cents. */
export function editedAmount(
  edits: ClientTemplateLineEditInput[],
  ref: TemplateAmountFieldRef,
): number | null | undefined {
  const edit = edits.find((candidate) => candidate.template_line_id === ref.line.template_line_id);
  if (!edit) return undefined;
  switch (ref.kind) {
    case 'line_base_rate':
      return edit.fixed_base_rate;
    case 'line_overtime_rate':
      return edit.overtime_rate;
    case 'member_rate':
      return edit.services?.find((s) => s.service_id === ref.service!.service_id)?.rate;
    case 'member_overtime_rate':
      return edit.services?.find((s) => s.service_id === ref.service!.service_id)?.overtime_rate;
    case 'legacy_bucket_overage_rate':
      return edit.services?.find((s) => s.service_id === ref.service!.service_id)?.bucket_overage_rate;
    case 'bucket_overage_rate':
      return edit.bucket_overage_rates?.find((p) => p.bucket_id === ref.poolId)?.rate;
  }
}

/**
 * What the contract will get for this field: the edit, else the amount that
 * resolved in the contract currency. A required member rate also counts its
 * client-currency catalog price (the same fallback the server clone applies).
 */
export function effectiveAmount(
  edits: ClientTemplateLineEditInput[],
  ref: TemplateAmountFieldRef,
): number | null {
  const edited = editedAmount(edits, ref);
  if (edited !== undefined) return edited;
  if (ref.field.amount != null) return ref.field.amount;
  if (ref.kind === 'member_rate' && ref.field.required) return ref.field.catalog_amount;
  return null;
}

/** Return `edits` with one field's edit set (`undefined` removes the override). */
export function withAmountEdit(
  edits: ClientTemplateLineEditInput[],
  ref: TemplateAmountFieldRef,
  cents: number | null | undefined,
): ClientTemplateLineEditInput[] {
  const lineId = ref.line.template_line_id;
  const existing = edits.find((edit) => edit.template_line_id === lineId);
  const base: ClientTemplateLineEditInput = existing ?? { template_line_id: lineId };
  const patchService = (key: 'rate' | 'overtime_rate' | 'bucket_overage_rate') => {
    const services = [...(base.services ?? [])];
    const index = services.findIndex((s) => s.service_id === ref.service!.service_id);
    if (index >= 0) services[index] = { ...services[index], [key]: cents };
    else services.push({ service_id: ref.service!.service_id, [key]: cents });
    return { ...base, services };
  };
  let next: ClientTemplateLineEditInput;
  switch (ref.kind) {
    case 'line_base_rate':
      next = { ...base, fixed_base_rate: cents };
      break;
    case 'line_overtime_rate':
      next = { ...base, overtime_rate: cents };
      break;
    case 'member_rate':
      next = patchService('rate');
      break;
    case 'member_overtime_rate':
      next = patchService('overtime_rate');
      break;
    case 'legacy_bucket_overage_rate':
      next = patchService('bucket_overage_rate');
      break;
    case 'bucket_overage_rate': {
      const rates = [...(base.bucket_overage_rates ?? [])];
      const index = rates.findIndex((p) => p.bucket_id === ref.poolId);
      if (index >= 0) rates[index] = { bucket_id: ref.poolId!, rate: cents ?? null };
      else rates.push({ bucket_id: ref.poolId!, rate: cents ?? null });
      next = { ...base, bucket_overage_rates: rates };
      break;
    }
  }
  return existing
    ? edits.map((edit) => (edit.template_line_id === lineId ? next : edit))
    : [...edits, next];
}

/**
 * Required amounts the template has no value for in the contract currency and
 * that the operator has not filled (nor the catalog supplies). A blank blocks
 * creation, mirroring the server's completeness check.
 */
export function findMissingTemplateAmounts(
  view: ClientTemplateLinesView,
  edits: ClientTemplateLineEditInput[],
): TemplateAmountFieldRef[] {
  return listTemplateAmountFields(view).filter(
    (ref) => ref.field.required && effectiveAmount(edits, ref) == null,
  );
}

/**
 * Edits that pre-fill every required, unset member rate that has a catalog
 * price in the contract currency. They are sent as edits so the server writes
 * exactly what the form shows. Fields the operator already edited are untouched.
 */
export function prefillCatalogEdits(
  view: ClientTemplateLinesView,
  edits: ClientTemplateLineEditInput[],
): ClientTemplateLineEditInput[] {
  let next = edits;
  for (const ref of listTemplateAmountFields(view)) {
    if (ref.kind !== 'member_rate') continue;
    if (!ref.field.required || ref.field.amount != null || ref.field.catalog_amount == null) continue;
    if (editedAmount(next, ref) !== undefined) continue;
    next = withAmountEdit(next, ref, ref.field.catalog_amount);
  }
  return next;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Human label of an amount field: "Line · Service · Hourly rate". */
export function describeTemplateAmountField(t: Translate, ref: TemplateAmountFieldRef): string {
  const lineType = ref.line.line_type;
  const memberRateLabel =
    lineType === 'Hourly'
      ? t('wizardTemplateLines.hourlyRate', { defaultValue: 'Hourly rate' })
      : lineType === 'Usage'
        ? t('wizardTemplateLines.unitRate', { defaultValue: 'Unit rate' })
        : t('wizardTemplateLines.serviceRate', { defaultValue: 'Service rate' });
  const overtime = t('wizardTemplateLines.overtimeRate', { defaultValue: 'Overtime rate' });
  const overage = t('wizardTemplateLines.bucketOverageRate', { defaultValue: 'Overage rate' });
  switch (ref.kind) {
    case 'line_base_rate':
      return `${ref.line.line_name} · ${t('wizardTemplateLines.fixedBaseRate', { defaultValue: 'Fixed base rate' })}`;
    case 'line_overtime_rate':
      return `${ref.line.line_name} · ${overtime}`;
    case 'member_rate':
      return `${ref.line.line_name} · ${ref.service!.service_name} · ${memberRateLabel}`;
    case 'member_overtime_rate':
      return `${ref.line.line_name} · ${ref.service!.service_name} · ${overtime}`;
    case 'legacy_bucket_overage_rate':
      return `${ref.line.line_name} · ${ref.service!.service_name} · ${overage}`;
    case 'bucket_overage_rate':
      return `${ref.line.line_name} · ${ref.poolName ?? ''} ${overage}`.replace(/ {2,}/g, ' ');
  }
}

/** The blocking message for unfilled required amounts (same text as the server's keyed error). */
export function missingTemplateAmountsMessage(
  t: Translate,
  view: ClientTemplateLinesView,
  missing: TemplateAmountFieldRef[],
): string {
  return t('errors.wizard.templateAmountsMissing', {
    defaultValue:
      'Cannot create contract in {{currency}}. The following amounts have no {{currency}} value: {{amounts}}. Enter an amount for each, or add {{currency}} rates to the template.',
    currency: view.currency_code,
    amounts: missing.map((ref) => `"${describeTemplateAmountField(t, ref)}"`).join(', '),
  });
}

/** Required slots the template's price set for the contract currency does not store. */
export function hasMissingPriceSetSlots(view: ClientTemplateLinesView): boolean {
  return listTemplateAmountFields(view).some((ref) => ref.field.required && ref.field.amount == null);
}

/**
 * Whether the operator changed a required amount the price set already stores.
 * Only required slots are persisted by "save to template", so only they count.
 */
export function hasEditedPriceSetAmounts(
  view: ClientTemplateLinesView,
  edits: ClientTemplateLineEditInput[],
): boolean {
  return listTemplateAmountFields(view).some((ref) => {
    if (!ref.field.required || ref.field.amount == null) return false;
    const edited = editedAmount(edits, ref);
    return edited != null && edited !== ref.field.amount;
  });
}
