'use client';

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import LoadingIndicator from "@alga-psa/ui/components/LoadingIndicator";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";
import { getTemplatesAction } from "../../actions";
import type { SystemEmailTemplate } from "../../types/notification";
import { EmailBrandingPanel } from "./EmailBrandingPanel";

/** The panel previews against every language; no table filter applies here. */
const NO_LANGUAGE_FILTER = new Set<string>();

/**
 * Standalone host for the email branding panel: its own settings tab, so the
 * templates tab stays compact. Loads the system templates the panel previews
 * against; everything else lives in the panel itself.
 */
export function EmailBrandingTab() {
  const { t } = useTranslation('msp/settings');
  const { data: session } = useSession();
  const [systemTemplates, setSystemTemplates] = useState<(SystemEmailTemplate & { category: string })[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const tenant = (session?.user as any)?.tenant as string | undefined;
        if (!tenant) return;
        const templates = await getTemplatesAction(tenant);
        setSystemTemplates(templates.systemTemplates);
      } catch (err) {
        console.error('Failed to load templates for email branding:', err);
        setError(t('notifications.emailTemplatesUi.errors.loadFailed', 'Failed to load templates'));
      }
    }
    init();
  }, [session]);

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  if (!systemTemplates) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator
          layout="stacked"
          text={t('notifications.emailTemplatesUi.list.loading', 'Loading email templates...')}
          spinnerProps={{ size: 'md' }}
        />
      </div>
    );
  }

  return (
    <EmailBrandingPanel
      systemTemplates={systemTemplates}
      selectedLanguages={NO_LANGUAGE_FILTER}
    />
  );
}
