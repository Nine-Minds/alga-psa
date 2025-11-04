'use client';

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { assetActionItems } from 'server/src/config/menuConfig';
import { Button } from 'server/src/components/ui/Button';
import { analytics } from 'server/src/lib/analytics/client';
import { cn } from 'server/src/lib/utils';
import { ChevronRight } from 'lucide-react';

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
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Asset Tools
        </h2>
        <nav className="space-y-2.5">
          {assetActionItems.map((item) => {
            const isActive = pathname?.startsWith(item.href ?? '') ?? false;
            return (
              <Button
                key={item.id}
                id={`asset-action-${item.id}`}
                variant="ghost"
                size="sm"
                className={cn(
                  'h-auto min-h-[3.25rem] w-full items-start justify-between gap-3 rounded-lg border border-transparent px-3.5 py-3.5 text-left transition',
                  'hover:border-slate-200 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-primary-100 focus-visible:ring-offset-1',
                  isActive && 'border-primary-200 bg-primary-50 text-primary-700 hover:border-primary-200 hover:bg-primary-100/40'
                )}
                onClick={() => handleNavigate(item.href, item.onClickEvent)}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="flex flex-1 items-start gap-3.5">
                  <span
                    className={cn(
                      'flex h-8 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600',
                      isActive && 'border-primary-200 bg-white text-primary-600'
                    )}
                    aria-hidden="true"
                  >
                    <item.icon className="h-4 w-4" />
                  </span>
                  <span className="space-y-1">
                    <span className="block text-sm font-semibold text-slate-900">{item.label}</span>
                    <span className="block text-xs leading-snug text-slate-500">{item.description}</span>
                  </span>
                </span>
                <ChevronRight
                  className={cn('h-4 w-4 text-slate-300', isActive && 'text-primary-500')}
                  aria-hidden="true"
                />
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
