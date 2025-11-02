'use client';

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { assetActionItems } from 'server/src/config/menuConfig';
import { Button } from 'server/src/components/ui/Button';
import { analytics } from 'server/src/lib/analytics/client';

export function AssetActionRail() {
  const router = useRouter();
  const pathname = usePathname();

  const handleNavigate = (href?: string, event?: string) => {
    if (!href) {
      return;
    }
    if (event) {
      analytics.capture(event, { source: 'asset_action_rail' });
    }
    router.push(href);
  };

  return (
    <aside
      className="w-full md:w-64 shrink-0 md:sticky md:top-20 space-y-4"
      aria-label="Asset workspace tools"
    >
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
          Asset Tools
        </h2>
        <nav className="space-y-2">
          {assetActionItems.map((item) => {
            const isActive = pathname?.startsWith(item.href ?? '') ?? false;
            return (
              <Button
                key={item.id}
                id={`asset-action-${item.id}`}
                variant={isActive ? 'soft' : 'ghost'}
                size="sm"
                className="w-full justify-start gap-3 px-3 py-2 text-left"
                onClick={() => handleNavigate(item.href, item.onClickEvent)}
                aria-current={isActive ? 'page' : undefined}
              >
                <item.icon className="h-4 w-4 text-slate-600" />
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-slate-900">{item.label}</span>
                  <span className="text-xs text-slate-500">{item.description}</span>
                </span>
              </Button>
            );
          })}
        </nav>
      </div>
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
        <p className="font-semibold text-slate-600 mb-1">Need another shortcut?</p>
        <p>We&apos;ll extend the rail as additional modules go live.</p>
      </div>
    </aside>
  );
}
