'use client';

import type { PortalTicketExternalLink } from '@alga-psa/types';
import { Card } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export function PortalTicketExternalLinks({ links }: { links: PortalTicketExternalLink[] }) {
  const { t } = useTranslation('features/tickets');
  if (links.length === 0) return null;

  return (
    <Card className="p-4 space-y-3">
      <h2 className="text-sm font-semibold">{t('externalLinks.title', 'External links')}</h2>
      <p className="text-sm text-[rgb(var(--color-text-600))]">
        {t('externalLinks.visibility.help', 'Customers with access to this ticket can see this link. Sharing the link does not grant access to the external system.')}
      </p>
      <ul className="space-y-3">
        {links.map((link, index) => (
          <li key={`${link.url}-${index}`} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm break-all">{link.label}</span>
            <a
              id={`portal-external-record-${index}`}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${t('externalLinks.actions.openRecord', 'Open external record')}: ${link.label}`}
              className="text-sm text-primary-600 hover:underline dark:text-primary-400"
            >
              {t('externalLinks.actions.openRecord', 'Open external record')}
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
