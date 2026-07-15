import { z } from 'zod';

export const projectBillingModelSchema = z.enum(['fixed_price', 'time_and_materials']);
export const projectBillingInvoiceModeSchema = z.enum(['recurring', 'standalone']);
export const projectBillingCapBehaviorSchema = z.enum(['notify', 'hard_cap']);
export const projectBillingDepositTreatmentSchema = z.enum(['credit', 'deduct_final']);
export const projectBillingScheduleEntryTypeSchema = z.enum(['milestone', 'deposit']);
export const projectBillingTriggerTypeSchema = z.enum(['phase', 'date', 'manual']);
export const projectBillingScheduleStatusSchema = z.enum([
  'pending',
  'ready',
  'approved',
  'invoiced',
  'canceled'
]);

const currencySchema = z.string().trim().regex(/^[A-Za-z]{3}$/, 'currency must be a 3-letter code');

const capNotifyThresholdsSchema = z.array(
  z.number().min(1).max(100)
).superRefine((thresholds, ctx) => {
  for (let index = 1; index < thresholds.length; index += 1) {
    if (thresholds[index] <= thresholds[index - 1]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'cap_notify_thresholds must be in strictly ascending order',
        path: [index]
      });
    }
  }
});

const projectBillingConfigBaseSchema = z.object({
  project_id: z.string().uuid(),
  billing_model: projectBillingModelSchema,
  total_price: z.number().int().nonnegative().optional().nullable(),
  currency: currencySchema.optional().nullable(),
  invoice_mode: projectBillingInvoiceModeSchema.default('recurring'),
  contract_id: z.string().uuid().optional().nullable(),
  cap_amount: z.number().int().nonnegative().optional().nullable(),
  cap_behavior: projectBillingCapBehaviorSchema.optional().nullable(),
  cap_notify_thresholds: capNotifyThresholdsSchema.default([75, 90, 100]),
  deposit_treatment: projectBillingDepositTreatmentSchema.default('credit'),
  is_taxable: z.boolean().default(true),
  tax_region: z.string().trim().optional().nullable()
});

export const createProjectBillingConfigSchema = projectBillingConfigBaseSchema;
export const updateProjectBillingConfigSchema = projectBillingConfigBaseSchema.partial();

const projectBillingScheduleEntryBaseSchema = z.object({
  config_id: z.string().uuid(),
  entry_type: projectBillingScheduleEntryTypeSchema,
  description: z.string().trim().min(1),
  amount: z.number().int().nonnegative().optional().nullable(),
  percentage: z.number().positive().max(100).optional().nullable(),
  trigger_type: projectBillingTriggerTypeSchema,
  phase_id: z.string().uuid().optional().nullable(),
  trigger_date: z.coerce.date().optional().nullable(),
  status: projectBillingScheduleStatusSchema.default('pending'),
  display_order: z.number().int().min(0).default(0)
});

function validateAmountXorPercentage(
  value: { amount?: number | null; percentage?: number | null },
  ctx: z.RefinementCtx
): void {
  const hasAmount = value.amount !== undefined && value.amount !== null;
  const hasPercentage = value.percentage !== undefined && value.percentage !== null;

  if (hasAmount === hasPercentage) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'exactly one of amount or percentage is required',
      path: ['amount']
    });
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'exactly one of amount or percentage is required',
      path: ['percentage']
    });
  }
}

export const createProjectBillingScheduleEntrySchema = projectBillingScheduleEntryBaseSchema.superRefine(
  validateAmountXorPercentage
);

export const updateProjectBillingScheduleEntrySchema = projectBillingScheduleEntryBaseSchema
  .partial()
  .superRefine((value, ctx) => {
    const includesAmount = Object.prototype.hasOwnProperty.call(value, 'amount');
    const includesPercentage = Object.prototype.hasOwnProperty.call(value, 'percentage');

    if (!includesAmount && !includesPercentage) return;
    if (!includesAmount || !includesPercentage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'amount and percentage must be updated together, with exactly one set to null',
        path: includesAmount ? ['percentage'] : ['amount']
      });
      return;
    }

    validateAmountXorPercentage(value, ctx);
  });

export type CreateProjectBillingConfigInput = z.infer<typeof createProjectBillingConfigSchema>;
export type UpdateProjectBillingConfigInput = z.infer<typeof updateProjectBillingConfigSchema>;
export type CreateProjectBillingScheduleEntryInput = z.infer<typeof createProjectBillingScheduleEntrySchema>;
export type UpdateProjectBillingScheduleEntryInput = z.infer<typeof updateProjectBillingScheduleEntrySchema>;
