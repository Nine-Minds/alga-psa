import React, { useMemo } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getComponentSchema } from '../schema/componentSchema';
import type { DesignerInspectorTab } from '../schema/inspectorSchema';
import type { DesignerNode } from '../state/designerStore';
import { isEmptyValue, isFieldSetOnNode, isRuleVisible, readFieldValue, resolveDefaultNodeProps } from './fieldState';

// Size lives in the shell's Size control rather than a schema panel.
const SIZE_SUMMARY_FIELDS: Array<{ key: 'width' | 'height' | 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight'; label: string }> = [
  { key: 'width', label: 'Width' },
  { key: 'height', label: 'Height' },
  { key: 'minWidth', label: 'Min width' },
  { key: 'maxWidth', label: 'Max width' },
  { key: 'minHeight', label: 'Min height' },
  { key: 'maxHeight', label: 'Max height' },
];

const CONTAINER_LAYOUT_SUMMARY_FIELDS: Array<{ key: 'display' | 'flexDirection' | 'alignItems' | 'justifyContent'; label: string }> = [
  { key: 'display', label: 'Mode' },
  { key: 'flexDirection', label: 'Direction' },
  { key: 'alignItems', label: 'Align Items' },
  { key: 'justifyContent', label: 'Justify Content' },
];

const formatSummaryValue = (value: unknown): string => {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value);
  return text.length > 28 ? `${text.slice(0, 27)}…` : text;
};

type NodeOverridesSummaryProps = {
  node: DesignerNode;
  nodesById: Map<string, DesignerNode>;
  onJumpToTab: (tab: DesignerInspectorTab) => void;
};

/**
 * Everything this block sets beyond a new block's defaults, across all tabs, in one
 * glance; each entry opens the tab that edits it.
 */
export const NodeOverridesSummary: React.FC<NodeOverridesSummaryProps> = ({ node, nodesById, onJumpToTab }) => {
  const { t } = useTranslation('msp/invoicing');
  const parent = node.parentId ? nodesById.get(node.parentId) ?? null : null;
  const entries = useMemo(() => {
    const panels = getComponentSchema(node.type).inspector?.panels ?? [];
    const fromSchema = panels
      .filter((panel) => isRuleVisible(panel.visibleWhen, node, parent))
      .flatMap((panel) =>
        panel.fields
          .filter((field) => isRuleVisible(field.visibleWhen, node, parent) && isFieldSetOnNode(node, field))
          .map((field) => ({
            id: `${panel.id}.${field.id}`,
            tab: panel.tab ?? 'content',
            label: t(`designer.schema.panels.${panel.id}.fields.${field.id}.label`, {
              defaultValue: 'label' in field ? field.label : field.id,
            }),
            value: formatSummaryValue(readFieldValue(node, field)),
          }))
      );
    const style = (node.props.style ?? {}) as Record<string, unknown>;
    const defaults = resolveDefaultNodeProps(node.type).props.style as Record<string, unknown>;
    const fromSize = SIZE_SUMMARY_FIELDS.filter(
      ({ key }) => !isEmptyValue(style[key]) && style[key] !== defaults[key]
    ).map(({ key, label }) => ({
      id: `size.${key}`,
      tab: 'layout' as DesignerInspectorTab,
      label: t(`designer.inspector.${key}`, { defaultValue: label }),
      value: formatSummaryValue(style[key]),
    }));
    // A container's direction and alignment are edited by the shell's Layout Controls.
    const layout = (node.props.layout ?? {}) as Record<string, unknown>;
    const layoutDefaults = resolveDefaultNodeProps(node.type).props.layout as Record<string, unknown>;
    const fromLayout = node.allowedChildren.length === 0
      ? []
      : CONTAINER_LAYOUT_SUMMARY_FIELDS.filter(
          ({ key }) => !isEmptyValue(layout[key]) && layout[key] !== layoutDefaults[key]
        ).map(({ key, label }) => ({
          id: `layout.${key}`,
          tab: 'layout' as DesignerInspectorTab,
          label: t(`designer.schema.panels.layout.fields.${key}.label`, { defaultValue: label }),
          value: formatSummaryValue(layout[key]),
        }));
    return [...fromSchema, ...fromLayout, ...fromSize];
  }, [node, parent, t]);

  return (
    <div className="space-y-1" data-automation-id="designer-overrides-summary">
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {entries.length === 0
          ? t('designer.inspector.overrides.none', { defaultValue: 'Uses defaults only.' })
          : t('designer.inspector.overrides.title', { defaultValue: 'Set on this block ({{count}}):', count: entries.length })}
      </p>
      {entries.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              id={`designer-override-${entry.id.replace(/[^a-zA-Z0-9]+/g, '-')}`}
              className="max-w-full truncate rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-[rgb(var(--color-card))] px-1.5 py-0.5 text-[10px] text-slate-600 dark:text-slate-300 hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30"
              title={t('designer.inspector.overrides.jump', { defaultValue: 'Edit in the {{tab}} tab', tab: entry.tab })}
              onClick={() => onJumpToTab(entry.tab)}
            >
              <span className="font-medium">{entry.label}:</span> {entry.value}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

