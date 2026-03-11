'use client';

import React from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import type { IUser } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export interface OrgChartNodeData {
  user: IUser;
  avatarUrl: string | null;
  roleLabel: string;
  isHighlighted?: boolean;
}

const OrgChartNode = ({ data }: NodeProps<OrgChartNodeData>) => {
  const { t } = useTranslation('msp/settings');
  const { user, avatarUrl, roleLabel, isHighlighted } = data;
  const displayName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;

  return (
    <div className={`rounded-lg border px-4 py-3 shadow-sm min-w-[220px] ${isHighlighted ? 'border-primary-500 ring-2 ring-primary-500 bg-primary-50' : 'border-border-200 bg-white'}`}>
      <Handle type="target" position={Position.Top} className="!bg-border-300" />
      <div className="flex items-center gap-3">
        <UserAvatar
          userId={user.user_id}
          userName={displayName}
          avatarUrl={avatarUrl}
          size="sm"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold text-text-800">{displayName}</div>
            {user.is_inactive && (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('orgChart.badge.inactive')}</span>
            )}
          </div>
          <div className="truncate text-xs text-text-600">{roleLabel}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-border-300" />
    </div>
  );
};

export default OrgChartNode;
