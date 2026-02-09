'use client';

/* global process */

import dynamic from 'next/dynamic';
import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@alga-psa/ui/components/Card";
import CustomTabs, { TabContent } from "@alga-psa/ui/components/CustomTabs";
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';

const isEEAvailable = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

const DynamicExtensionsComponent = isEEAvailable ? dynamic(() =>
  import('@product/settings-extensions/entry').then(mod => mod.DynamicExtensionsComponent),
  {
    loading: () => (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator
          layout="stacked"
          text="Loading extensions..."
          spinnerProps={{ size: 'md' }}
        />
      </div>
    ),
    ssr: false
  }
) : () => <div className="text-center py-8 text-gray-500">Extensions not available in this edition</div>;

const DynamicInstallComponent = isEEAvailable ? dynamic(() =>
  import('@product/settings-extensions/entry').then(mod => mod.DynamicInstallExtensionComponent as unknown as React.ComponentType),
  {
    loading: () => (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator
          layout="stacked"
          text="Loading installer..."
          spinnerProps={{ size: 'md' }}
        />
      </div>
    ),
    ssr: false
  }
) : () => null;

export default function ExtensionManagement() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Extension Management</CardTitle>
        <CardDescription>
          Install, configure, and manage extensions to extend Alga PSA functionality.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isEEAvailable ? (
          <div className="space-y-4">
            <CustomTabs
              tabs={[
                {
                  label: "Manage",
                  content: (
                    <div className="py-2 space-y-3">
                      <DynamicExtensionsComponent />
                      <div className="flex items-center justify-end gap-2 text-[10px]">
                        <span className="text-slate-500">
                          Need extension logs?
                        </span>
                        <Link
                          href="/msp/extensions/d773f8f7-c46d-4c9d-a79b-b55903dd5074/debug"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100 hover:border-violet-300 transition-colors"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          Open Service Proxy Demo Debug Console
                        </Link>
                      </div>
                    </div>
                  )
                },
                {
                  label: "Install",
                  content: (
                    <div className="py-2">
                      <DynamicInstallComponent />
                    </div>
                  )
                }
              ] as TabContent[]}
              defaultTab="Manage"
            />
          </div>
        ) : (
          <div className="text-center py-10">
            <div className="text-lg font-medium text-gray-900">Enterprise feature</div>
            <p className="text-sm text-gray-600 mt-2">
              Extensions are available in the Enterprise edition of Alga PSA.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
