'use client';

import React from 'react';
import { Info } from 'lucide-react';
import { useTranslation } from '../lib/i18n/client';
import type { BillingProfileSource, ContractLineSource } from '@alga-psa/types';
import {
  billingProfileSourceSentence,
  chargeGranularityLimitation,
  contractLineSourceSentence,
} from '../lib/billingProfileAttributionCopy';

/**
 * The attribution inspector (F065, F066, F070).
 *
 * Shown on an invoice line and on a time entry. It renders a sentence, not a
 * data dump: a biller looking at a charge on the wrong invoice needs to know
 * which assignment put it there so they can go and change it.
 *
 * It renders nothing when there is nothing to explain — an unattributed charge
 * on a single-profile client is not a mystery worth a paragraph, and showing
 * one would leak the feature into clients that do not have it (decision D6).
 */

export interface BillingAttributionInspectorProps {
  /** Which chain step produced the charge's profile. */
  billingProfileSource?: BillingProfileSource | null;
  profileName?: string | null;
  contractName?: string | null;
  contractLineName?: string | null;
  workItemName?: string | null;
  /** How the entry's contract line was chosen, on time-entry surfaces. */
  contractLineSource?: ContractLineSource | null;
  /** Used to state the granularity limitation where one applies. */
  chargeType?: string | null;
  /**
   * Render even for a client with one profile. Off by default: the profile
   * sentence is meaningless when there is only one profile to be billed to.
   */
  alwaysShowProfileSentence?: boolean;
  isSegmented?: boolean;
  className?: string;
}

export function BillingAttributionInspector({
  billingProfileSource,
  profileName,
  contractName,
  contractLineName,
  workItemName,
  contractLineSource,
  chargeType,
  alwaysShowProfileSentence = false,
  isSegmented = false,
  className,
}: BillingAttributionInspectorProps) {
  const { t } = useTranslation('msp/billing');

  const showProfileSentence =
    Boolean(billingProfileSource) && (alwaysShowProfileSentence || isSegmented);

  const sentences: string[] = [];
  if (showProfileSentence && billingProfileSource) {
    sentences.push(
      billingProfileSourceSentence(t, billingProfileSource, {
        profileName,
        contractName,
        contractLineName,
        workItemName,
      }),
    );
  }
  if (contractLineSource) {
    sentences.push(contractLineSourceSentence(t, contractLineSource, { contractLineName }));
  }
  const limitation = chargeGranularityLimitation(t, chargeType);
  if (limitation && showProfileSentence) {
    sentences.push(limitation);
  }

  if (sentences.length === 0) {
    return null;
  }

  return (
    <div className={`flex gap-2 rounded-md bg-gray-50 p-3 text-xs text-gray-600 ${className ?? ''}`}>
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="space-y-1">
        {sentences.map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
      </div>
    </div>
  );
}

export default BillingAttributionInspector;
