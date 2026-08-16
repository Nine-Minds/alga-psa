import type { BillingProfileSource, ContractLineSource } from '@alga-psa/types';

/**
 * Plain-language attribution copy (F067, F070).
 *
 * The attribution inspector renders a sentence, not a data dump. A user looking
 * at a charge on the wrong invoice needs to know *why* it landed there in terms
 * they can act on — "the contract line is assigned to it" tells them where to go
 * and change it; `contract_line` does not.
 *
 * Every source value gets its own sentence. A shared "attributed via {{source}}"
 * template would be the same data dump with extra steps.
 */

export interface AttributionCopyContext {
  profileName?: string | null;
  contractName?: string | null;
  contractLineName?: string | null;
  workItemName?: string | null;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

const PROFILE_PLACEHOLDER = 'this profile';

export function billingProfileSourceSentence(
  t: Translate,
  source: BillingProfileSource,
  context: AttributionCopyContext = {},
): string {
  const profile = context.profileName || PROFILE_PLACEHOLDER;

  switch (source) {
    case 'explicit':
      return t('attribution.profile.explicit', {
        profile,
        defaultValue: 'Billed to {{profile}} because it was chosen for this charge directly.',
      });
    case 'contract_line':
      return context.contractLineName
        ? t('attribution.profile.contractLineNamed', {
            profile,
            line: context.contractLineName,
            defaultValue: 'Billed to {{profile}} because the contract line "{{line}}" is assigned to it.',
          })
        : t('attribution.profile.contractLine', {
            profile,
            defaultValue: 'Billed to {{profile}} because the contract line is assigned to it.',
          });
    case 'contract':
      return context.contractName
        ? t('attribution.profile.contractNamed', {
            profile,
            contract: context.contractName,
            defaultValue: 'Billed to {{profile}} because the contract "{{contract}}" is assigned to it.',
          })
        : t('attribution.profile.contract', {
            profile,
            defaultValue: 'Billed to {{profile}} because the contract is assigned to it.',
          });
    case 'work_item':
      return context.workItemName
        ? t('attribution.profile.workItemNamed', {
            profile,
            workItem: context.workItemName,
            defaultValue:
              'Billed to {{profile}} because "{{workItem}}" is assigned to it; no contract assignment applies.',
          })
        : t('attribution.profile.workItem', {
            profile,
            defaultValue:
              'Billed to {{profile}} because the ticket or project is assigned to it; no contract assignment applies.',
          });
    case 'client_default':
      return t('attribution.profile.clientDefault', {
        profile,
        defaultValue:
          "Billed to {{profile}} because nothing else claimed this charge — it fell back to the client's default profile.",
      });
    default:
      return t('attribution.profile.unknown', {
        defaultValue: 'This charge has no recorded attribution.',
      });
  }
}

export function contractLineSourceSentence(
  t: Translate,
  source: ContractLineSource,
  context: { contractLineName?: string | null } = {},
): string {
  const line = context.contractLineName || 'the contract line';

  switch (source) {
    case 'explicit':
      return t('attribution.line.explicit', {
        line,
        defaultValue: 'Someone chose {{line}} for this entry.',
      });
    case 'auto_unique_service':
      return t('attribution.line.autoUniqueService', {
        line,
        defaultValue: '{{line}} was the only contract line covering this service.',
      });
    case 'auto_bucket_overlay':
      return t('attribution.line.autoBucketOverlay', {
        line,
        defaultValue: 'Several contract lines covered this service; {{line}} was the only one with a bucket.',
      });
    case 'auto_billing_profile':
      return t('attribution.line.autoBillingProfile', {
        line,
        defaultValue:
          "Several contract lines covered this service; {{line}} was picked because it belongs to the work item's billing profile.",
      });
    case 'reconciled_at_generation':
      return t('attribution.line.reconciled', {
        line,
        defaultValue: '{{line}} was matched to this entry when the invoice was generated.',
      });
    case 'unresolved':
      return t('attribution.line.unresolved', {
        defaultValue: 'No contract line could be chosen for this entry.',
      });
    default:
      return t('attribution.line.unknown', {
        defaultValue: 'How this contract line was chosen was not recorded.',
      });
  }
}

/**
 * Charge types whose source record carries no segment at all, and the sentence
 * that says so (F070).
 *
 * Stating the limitation is the point. Where a charge cannot reach work-item
 * granularity, a user comparing a per-site number against their own records
 * will otherwise conclude the number is wrong rather than that it is coarse.
 */
const CONTRACT_GRANULAR_CHARGE_TYPES = new Set([
  'usage',
  'bucket',
  'fixed',
  'product',
  'license',
]);

export function chargeGranularityLimitation(
  t: Translate,
  chargeType: string | null | undefined,
): string | null {
  if (!chargeType) return null;
  if (!CONTRACT_GRANULAR_CHARGE_TYPES.has(chargeType)) return null;
  return t('attribution.limitation.contractGranular', {
    defaultValue:
      'This charge type has no per-item record behind it, so it can only be attributed as far as the contract — not to the specific site or work it came from.',
  });
}
