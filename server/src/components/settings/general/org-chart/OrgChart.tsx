'use client';

import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Edge, Node, NodeTypes } from 'reactflow';
import type { IUser } from '@alga-psa/types';
import { useDrawer } from '@alga-psa/ui';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import UserDetails from '../UserDetails';
import OrgChartNode, { type OrgChartNodeData } from './OrgChartNode';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const OrgChartFlow = dynamic(() => import('./OrgChartFlow'), { ssr: false });

interface OrgChartProps {
  users: IUser[];
  onUserUpdated: () => void;
  searchTerm?: string;
}

const NODE_WIDTH = 240;
const NODE_HEIGHT = 80;
const HORIZONTAL_GAP = 40;
const VERTICAL_GAP = 120;

const OrgChart = ({ users, onUserUpdated, searchTerm = '' }: OrgChartProps) => {
  const { t } = useTranslation('msp/settings');
  const { openDrawer } = useDrawer();
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string | null>>({});

  useEffect(() => {
    const fetchAvatarUrls = async () => {
      if (users.length === 0) {
        setAvatarUrls({});
        return;
      }

      const tenant = users[0]?.tenant;
      if (!tenant) {
        return;
      }

      try {
        const map = await getUserAvatarUrlsBatchAction(users.map((user) => user.user_id), tenant);
        const record: Record<string, string | null> = {};
        map.forEach((value, key) => {
          record[key] = value;
        });
        setAvatarUrls(record);
      } catch (error) {
        console.error('Failed to load avatar URLs for org chart', error);
      }
    };

    fetchAvatarUrls();
  }, [users]);
  const { nodes, edges } = useMemo(() => {
    if (users.length === 0) {
      return { nodes: [] as Node<OrgChartNodeData>[], edges: [] as Edge[] };
    }

    const nodesById = new Map<string, { user: IUser; children: IUser[] }>();
    users.forEach((user) => {
      nodesById.set(user.user_id, { user, children: [] });
    });

    const roots: IUser[] = [];
    users.forEach((user) => {
      if (user.reports_to && nodesById.has(user.reports_to)) {
        nodesById.get(user.reports_to)?.children.push(user);
      } else {
        roots.push(user);
      }
    });

    const getDisplayName = (user: IUser) => {
      const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
      return fullName || user.email;
    };

    const sortTree = (list: IUser[]) => {
      list.sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)));
      list.forEach((user) => {
        const node = nodesById.get(user.user_id);
        if (node) {
          sortTree(node.children);
        }
      });
    };

    sortTree(roots);

    const subtreeWidth = new Map<string, number>();

    const measure = (userId: string): number => {
      const node = nodesById.get(userId);
      if (!node) {
        return NODE_WIDTH;
      }
      if (node.children.length === 0) {
        subtreeWidth.set(userId, NODE_WIDTH);
        return NODE_WIDTH;
      }
      const childrenWidths = node.children.map((child) => measure(child.user_id));
      const totalChildrenWidth = childrenWidths.reduce((sum, width) => sum + width, 0) + HORIZONTAL_GAP * (childrenWidths.length - 1);
      const width = Math.max(NODE_WIDTH, totalChildrenWidth);
      subtreeWidth.set(userId, width);
      return width;
    };

    roots.forEach((root) => measure(root.user_id));

    const positionedNodes: Node<OrgChartNodeData>[] = [];
    const positionedEdges: Edge[] = [];

    const assignPositions = (user: IUser, depth: number, startX: number) => {
      const width = subtreeWidth.get(user.user_id) ?? NODE_WIDTH;
      const x = startX + (width - NODE_WIDTH) / 2;
      const y = depth * (NODE_HEIGHT + VERTICAL_GAP);

      const lowerSearch = searchTerm.toLowerCase();
      const fullName = `${user.first_name || ''} ${user.last_name || ''}`.toLowerCase();
      const isHighlighted = lowerSearch.length > 0 && (
        fullName.includes(lowerSearch) || user.email.toLowerCase().includes(lowerSearch)
      );

      positionedNodes.push({
        id: user.user_id,
        type: 'orgChartNode',
        position: { x, y },
        data: {
          user,
          avatarUrl: avatarUrls[user.user_id] ?? null,
          roleLabel: user.user_type === 'client' ? t('orgChart.roles.client') : t('orgChart.roles.internal'),
          isHighlighted,
        },
      });

      const node = nodesById.get(user.user_id);
      if (!node) {
        return;
      }

      let childStartX = startX;
      node.children.forEach((child) => {
        const childWidth = subtreeWidth.get(child.user_id) ?? NODE_WIDTH;
        positionedEdges.push({
          id: `e-${user.user_id}-${child.user_id}`,
          source: user.user_id,
          target: child.user_id,
          type: 'smoothstep',
        });
        assignPositions(child, depth + 1, childStartX);
        childStartX += childWidth + HORIZONTAL_GAP;
      });
    };

    let currentX = 0;
    roots.forEach((root, index) => {
      const width = subtreeWidth.get(root.user_id) ?? NODE_WIDTH;
      if (index > 0) {
        currentX += HORIZONTAL_GAP;
      }
      assignPositions(root, 0, currentX);
      currentX += width;
    });

    return { nodes: positionedNodes, edges: positionedEdges };
  }, [users, avatarUrls, searchTerm, t]);

  const nodeTypes: NodeTypes = useMemo(() => ({
    orgChartNode: OrgChartNode,
  }), []);

  if (users.length === 0) {
    return <div className="text-sm text-muted-foreground">{t('orgChart.emptyState')}</div>;
  }

  return (
    <div className="h-[600px] w-full rounded-lg border border-border-200 bg-white">
      <OrgChartFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_event, node) => {
          openDrawer(<UserDetails userId={node.id} onUpdate={onUserUpdated} />);
        }}
      />
    </div>
  );
};

export default OrgChart;
