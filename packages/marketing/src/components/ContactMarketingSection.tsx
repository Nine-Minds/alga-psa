'use client';

import React, { useEffect, useState } from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Megaphone } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getContactMarketingProfile } from '../actions/contactStateActions';
import type { ContactMarketingProfile } from '../lib/contactState';
import { formatDateTime } from './format';

/**
 * Compact marketing summary for the contact record: consent state,
 * suppression, active sequence enrollments, and recent engagements.
 * Fetches its own data on mount so the host page stays untouched.
 */
export function ContactMarketingSection({ contactId }: { contactId: string }): React.ReactElement | null {
  const { t } = useTranslation('msp/core');
  const [profile, setProfile] = useState<ContactMarketingProfile | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getContactMarketingProfile(contactId)
      .then((result) => {
        if (!cancelled) {
          setProfile(result);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  if (!loaded) {
    return (
      <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4 text-sm text-[rgb(var(--color-text-400))]">
        {t('marketing.contact.loading', 'Loading marketing activity…')}
      </div>
    );
  }

  if (!profile) return null;

  const consent = profile.contactState?.consent === true;

  return (
    <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Megaphone className="h-4 w-4 text-[rgb(var(--color-primary-500))]" />
        <span className="text-sm font-semibold text-[rgb(var(--color-text-800))]">
          {t('marketing.contact.title', 'Marketing')}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <Badge variant={consent ? 'success' : 'default-muted'} size="sm">
            {consent ? t('marketing.contact.consentGiven', 'consent') : t('marketing.contact.noConsent', 'no consent')}
          </Badge>
          {profile.suppressed && (
            <Badge variant="error" size="sm">
              {t('marketing.contact.suppressed', 'suppressed')}
              {profile.suppressionReason ? ` · ${profile.suppressionReason}` : ''}
            </Badge>
          )}
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
            {t('marketing.contact.activeEnrollments', 'Active enrollments')}
          </div>
          {profile.activeEnrollments.length === 0 ? (
            <p className="text-xs text-[rgb(var(--color-text-400))]">
              {t('marketing.contact.noEnrollments', 'Not enrolled in any sequence.')}
            </p>
          ) : (
            <ul className="divide-y divide-[rgb(var(--color-border-100))]">
              {profile.activeEnrollments.map((enrollment) => (
                <li key={enrollment.enrollment_id} className="flex items-center gap-2 py-1.5">
                  <span className="truncate text-sm text-[rgb(var(--color-text-700))]">
                    {enrollment.sequence_name}
                  </span>
                  <span className="ml-auto flex-shrink-0 text-xs text-[rgb(var(--color-text-400))]">
                    {t('marketing.contact.enrollmentMeta', 'step {{step}} · next {{date}}', {
                      step: enrollment.current_step_order,
                      date: enrollment.next_send_at ? formatDateTime(enrollment.next_send_at) : '—',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
            {t('marketing.contact.recentEngagements', 'Recent engagements')}
          </div>
          {profile.engagements.length === 0 ? (
            <p className="text-xs text-[rgb(var(--color-text-400))]">
              {t('marketing.contact.noEngagements', 'No marketing touches yet.')}
            </p>
          ) : (
            <ul className="divide-y divide-[rgb(var(--color-border-100))]">
              {profile.engagements.slice(0, 5).map((engagement) => (
                <li key={engagement.engagement_id} className="flex items-center gap-2 py-1.5">
                  <span className="truncate text-sm text-[rgb(var(--color-text-700))]">
                    {engagement.title || engagement.type_name}
                  </span>
                  <span className="ml-auto flex-shrink-0 text-xs text-[rgb(var(--color-text-400))]">
                    {formatDateTime(engagement.interaction_date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
