import type { TFunction } from 'i18next';
import type { LayoutPresetDefinition, LayoutPresetNodeDefinition } from './presets';
import { resolveCollectionDescriptor } from '../../../lib/invoice-template-ast/collectionDescriptors';

const heading = 'Billed-time detail — included in the charges above';
const empty = 'No billed-time detail is available for this invoice.';
const documentKeys: Record<string, string> = {
  'entry-date': 'labels.date', 'entry-ticket': 'labels.ticket',
  'entry-hours': 'labels.hours', 'entry-rate': 'labels.rate', 'entry-amount': 'labels.amount',
};
const defaultText = ((_key: string, options: { defaultValue: string }) => options.defaultValue) as TFunction;

const node = (key: string, type: LayoutPresetNodeDefinition['type'], parentKey?: string): LayoutPresetNodeDefinition => ({
  key, type, parentKey, offset: { x: 0, y: 0 }, size: { width: 640, height: 40 },
  style: { width: '100%', height: 'auto' },
});

/** Both UI presets create ordinary editable nodes using the shared entry schema. */
const detailPreset = (grouped: boolean): LayoutPresetDefinition => ({
  id: grouped ? 'billed-time-by-ticket' : 'billed-time-entries',
  documentKind: 'invoice',
  label: grouped ? 'Billed-time detail by ticket' : 'Billed-time entry detail',
  description: grouped
    ? 'Repeat a work-item heading and its scoped entry table for each ticket or task.'
    : 'Add an informational entry table with dates, work items, hours, rates and amounts.',
  category: 'Body',
  nodes: [
    { ...node('detail', 'section'), name: grouped ? 'Ticket detail section' : 'Entry detail section', metadata: { title: '' },
      layout: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0px' } },
    { ...node('heading', 'text', 'detail'), name: 'Included-in-charges heading',
      metadata: { text: heading, __astContentPreviewText: heading,
        astContentExpression: { type: 'i18n', i18nKey: 'time.detail', defaultValue: heading } } },
    { ...node('notice', 'text', 'detail'), name: 'Entry coverage notice',
      metadata: { text: '{{ticketDetailNote}}', __astContentPreviewText: '{{ticketDetailNote}}',
        astContentExpression: { type: 'path', path: 'ticketDetailNote' } } },
    ...(grouped ? [
      { ...node('groups', 'container', 'detail'), name: 'Repeating ticket groups',
        layout: { display: 'flex' as const, flexDirection: 'column' as const, gap: '6px', padding: '0px' },
        metadata: { repeatCollectionBindingKey: 'ticketGroups', repeatItemBinding: 'group' } },
      { ...node('work-item', 'text', 'groups'), name: 'Work-item heading',
        metadata: { text: '{{group.label}}' } },
    ] : []),
    { ...node('entries', 'dynamic-table', grouped ? 'groups' : 'detail'),
      name: grouped ? 'Entries in this ticket group' : 'Billed-time entries',
      metadata: {
        collectionBindingKey: grouped ? 'group.entries' : 'timeEntries',
        emptyStateText: empty,
        __astEmptyStateTextI18n: { i18nKey: 'labels.emptyState.noBilledTimeDetail', defaultValue: empty },
        columns: resolveCollectionDescriptor('timeEntries')!.presets(defaultText)
          .filter((column) => Object.hasOwn(documentKeys, column.id))
          .map((column) => ({ id: column.id, header: column.header, type: column.type,
            key: column.id === 'entry-ticket' ? 'item.label' : column.key,
            __astHeaderI18n: { i18nKey: documentKeys[column.id], defaultValue: column.header } })),
      } },
  ],
});

export const BILLED_TIME_PRESETS = [detailPreset(false), detailPreset(true)];
