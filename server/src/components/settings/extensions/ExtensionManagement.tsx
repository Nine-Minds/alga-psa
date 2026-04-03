'use client';

/* global process */

import dynamic from 'next/dynamic';
import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@alga-psa/ui/components/Card";
import CustomTabs, { TabContent } from "@alga-psa/ui/components/CustomTabs";
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const isEEAvailable = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

function ExtensionsLoadingState() {
  const { t } = useTranslation('msp/extensions');

  return (
    <div className="flex items-center justify-center py-8">
      <LoadingIndicator
        layout="stacked"
        text={t('settings.loading.extensions', { defaultValue: 'Loading extensions...' })}
        spinnerProps={{ size: 'md' }}
      />
    </div>
  );
}

function InstallerLoadingState() {
  const { t } = useTranslation('msp/extensions');

  return (
    <div className="flex items-center justify-center py-8">
      <LoadingIndicator
        layout="stacked"
        text={t('settings.loading.installer', { defaultValue: 'Loading installer...' })}
        spinnerProps={{ size: 'md' }}
      />
    </div>
  );
}

function ExtensionsUnavailableState() {
  const { t } = useTranslation('msp/extensions');

  return (
    <div className="text-center py-8 text-gray-500">
      {t('communityEdition.listUnavailable', { defaultValue: 'Extensions not available in this edition' })}
    </div>
  );
}

const DynamicExtensionsComponent = isEEAvailable ? dynamic(() =>
  import('@product/settings-extensions/entry').then(mod => mod.DynamicExtensionsComponent),
  {
    loading: ExtensionsLoadingState,
    ssr: false
  }
) : ExtensionsUnavailableState;

const DynamicInstallComponent = isEEAvailable ? dynamic(() =>
  import('@product/settings-extensions/entry').then(mod => mod.DynamicInstallExtensionComponent as unknown as React.ComponentType),
  {
    loading: InstallerLoadingState,
    ssr: false
  }
) : () => null;

export default function ExtensionManagement() {
  const { t } = useTranslation('msp/extensions');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.title', { defaultValue: 'Extension Management' })}</CardTitle>
        <CardDescription>
          {t('settings.description', {
            defaultValue: 'Install, configure, and manage extensions to extend Alga PSA functionality.'
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isEEAvailable ? (
          <div className="space-y-4">
            <CustomTabs
              tabs={[
                {
                  id: 'manage',
                  label: t('settings.tabs.manage', { defaultValue: 'Manage' }),
                  content: (
                    <div className="py-2 space-y-3">
                      <DynamicExtensionsComponent />
                      <div className="flex items-center justify-end gap-2 text-[10px]">
                        <span className="text-slate-500">
                          {t('settings.links.needLogs', { defaultValue: 'Need extension logs?' })}
                        </span>
                        <Link
                          href="/msp/extensions/d773f8f7-c46d-4c9d-a79b-b55903dd5074/debug"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          {t('settings.links.debugConsole', { defaultValue: 'Open Service Proxy Demo Debug Console' })}
                        </Link>
                      </div>
                    </div>
                  )
                },
                {
                  id: 'install',
                  label: t('settings.tabs.install', { defaultValue: 'Install' }),
                  content: (
                    <div className="py-2">
                      <DynamicInstallComponent />
                    </div>
                  )
                }
              ] as TabContent[]}
              defaultTab="manage"
            />
          </div>
        ) : (
          <div className="text-center py-10">
            <div className="text-lg font-medium text-gray-900">
              {t('settings.enterpriseOnly.title', { defaultValue: 'Enterprise feature' })}
            </div>
            <p className="text-sm text-gray-600 mt-2">
              {t('settings.enterpriseOnly.description', {
                defaultValue: 'Extensions are available in the Enterprise edition of Alga PSA.'
              })}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
