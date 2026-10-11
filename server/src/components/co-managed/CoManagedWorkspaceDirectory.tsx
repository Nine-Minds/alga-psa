'use client';

import Link from 'next/link';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export interface CoManagedWorkspaceChoice { operationId: string; name: string }

/** Narrow a sponsor-side management screen that turned out to be a choice of
 * workspace rather than a screen. Returns null for a real screen. */
export function workspaceChoices(screen: unknown): CoManagedWorkspaceChoice[] | null {
  return screen && typeof screen === 'object' && (screen as { side?: unknown }).side === 'directory'
    ? (screen as { workspaces: CoManagedWorkspaceChoice[] }).workspaces : null;
}

// LEVERAGE: pattern co-managed-workspace-directory — CoManagedDelegatedAdministration
// renders this same list inline against its own `side: 'directory'` branch. It
// predates this component and is not re-pointed here, so the shape now exists twice.

/**
 * The choice a sponsor makes when a management route did not name a workspace.
 *
 * Navigating with `?operationId=` *is* the selection: every sponsor-side action
 * already accepts a provisioning operation as a compatibility selector, so
 * nothing downstream has to learn that a choice was made.
 */
export default function CoManagedWorkspaceDirectory({ basePath, idPrefix, workspaces }: {
  basePath: string; idPrefix: string; workspaces: CoManagedWorkspaceChoice[];
}) {
  const { t } = useTranslation('msp/licensing');
  if (!workspaces.length) return <p role="status">{t('coManaged.directory.empty')}</p>;
  return <div className="space-y-3">
    <p role="status">{t('coManaged.directory.prompt')}</p>
    {workspaces.map(workspace => <Card key={workspace.operationId}><CardContent className="p-4">
      <Link id={`${idPrefix}-${workspace.operationId}`} className="text-primary underline"
        href={`${basePath}?operationId=${encodeURIComponent(workspace.operationId)}`}>{workspace.name}</Link>
    </CardContent></Card>)}
  </div>;
}
