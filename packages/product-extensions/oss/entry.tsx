import React from 'react';
import type { Metadata } from 'next';
import { UpgradePrompt } from '@alga-psa/ui/components/UpgradePrompt';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

// OSS stub implementation for Extensions feature
export const metadata = {
  title: 'Extensions - Pro Feature'
};

export async function generateMetadata(): Promise<Metadata> {
  return metadata;
}

type PageParams = { id: string };

export default async function Page({ params }: { params: PageParams | Promise<PageParams> }) {
  const { t } = await getServerTranslation(undefined, 'msp/extensions');
  const resolvedParams = await params;

  return (
    <div className="p-6">
      <UpgradePrompt
        featureName={t('page.title', { defaultValue: 'Extensions' })}
        pitch={t('settings.description', {
          defaultValue: 'Install, configure, and manage extensions to extend AlgaPSA functionality.',
        })}
        ctaId="upgrade-extension-runtime-button"
      >
        <p>
          {t('detail.extensionId', {
            defaultValue: 'Extension ID: {{id}}',
            id: resolvedParams.id,
          })}
        </p>
      </UpgradePrompt>
    </div>
  );
}

// Named exports for compatibility
export const ExtensionPage = Page;
export const ExtensionPageMetadata = metadata;
