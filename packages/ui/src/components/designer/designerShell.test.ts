/**
 * The designer shell's pure parts — undo history, draft backup, palette search and grouping,
 * sidebar sizing. Nothing here may know about forms or service requests; the tests use a
 * made-up document shape on purpose, because a dashboard or report designer reuses these next.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  canRedoDesignerHistory,
  canUndoDesignerHistory,
  createDesignerHistory,
  pushDesignerHistory,
  redoDesignerHistory,
  undoDesignerHistory,
  DESIGNER_HISTORY_LIMIT,
} from './designerHistory';
import {
  clearDesignerDraftBackup,
  designerDraftBackupKey,
  readDesignerDraftBackup,
  shouldOfferDesignerDraftBackup,
  writeDesignerDraftBackup,
} from './designerDraftBackup';
import {
  groupDesignerPaletteItemsByCategory,
  matchesDesignerPaletteQuery,
} from './designerPaletteSearch';
import {
  DEFAULT_DESIGNER_SIDEBAR_WIDTH,
  MAX_DESIGNER_SIDEBAR_WIDTH,
  MIN_DESIGNER_SIDEBAR_WIDTH,
  WIDE_DESIGNER_SIDEBAR_WIDTH,
  clampDesignerSidebarWidth,
  getDesignerSidebarWidthFromDrag,
  readStoredDesignerSidebarWidth,
  storeDesignerSidebarWidth,
  toggleDesignerSidebarWidth,
} from './designerSidebarSizing';

type Doc = { title: string };

describe('designer undo history', () => {
  it('walks back and forward through the edits', () => {
    let history = createDesignerHistory<Doc>({ title: 'one' });
    expect(canUndoDesignerHistory(history)).toBe(false);

    history = pushDesignerHistory(history, { title: 'two' });
    history = pushDesignerHistory(history, { title: 'three' });
    expect(canUndoDesignerHistory(history)).toBe(true);

    history = undoDesignerHistory(history);
    expect(history.present).toEqual({ title: 'two' });
    expect(canRedoDesignerHistory(history)).toBe(true);

    history = redoDesignerHistory(history);
    expect(history.present).toEqual({ title: 'three' });
    expect(canRedoDesignerHistory(history)).toBe(false);
  });

  it('merges consecutive edits of the same thing into one step', () => {
    let history = createDesignerHistory<Doc>({ title: '' });
    // Typing a label is one undo step, not one per keystroke.
    history = pushDesignerHistory(history, { title: 'N' }, { coalesceId: 'label' });
    history = pushDesignerHistory(
      history,
      { title: 'Na' },
      { coalesceId: 'label', lastCoalesceId: 'label' }
    );
    history = pushDesignerHistory(
      history,
      { title: 'Nam' },
      { coalesceId: 'label', lastCoalesceId: 'label' }
    );

    expect(history.present).toEqual({ title: 'Nam' });
    expect(undoDesignerHistory(history).present).toEqual({ title: '' });
  });

  it('drops a new edit onto the past and forgets the redo branch', () => {
    let history = createDesignerHistory<Doc>({ title: 'one' });
    history = pushDesignerHistory(history, { title: 'two' });
    history = undoDesignerHistory(history);
    history = pushDesignerHistory(history, { title: 'other' });

    expect(canRedoDesignerHistory(history)).toBe(false);
    expect(history.present).toEqual({ title: 'other' });
  });

  it('records nothing for a push of the very same document', () => {
    const start = createDesignerHistory<Doc>({ title: 'one' });
    expect(pushDesignerHistory(start, start.present)).toBe(start);
  });

  it('keeps the history bounded', () => {
    let history = createDesignerHistory<Doc>({ title: 'start' });
    for (let step = 0; step < DESIGNER_HISTORY_LIMIT + 25; step += 1) {
      history = pushDesignerHistory(history, { title: `step-${step}` });
    }
    expect(history.past.length).toBe(DESIGNER_HISTORY_LIMIT);
  });

  it('is a no-op at either end', () => {
    const start = createDesignerHistory<Doc>({ title: 'one' });
    expect(undoDesignerHistory(start)).toBe(start);
    expect(redoDesignerHistory(start)).toBe(start);
  });
});

describe('designer draft backup', () => {
  const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('namespaces the key, and treats a never-saved draft as "new"', () => {
    expect(designerDraftBackupKey('formBuilder', 'def-1')).toBe(
      'alga.formBuilder.draftBackup.def-1'
    );
    expect(designerDraftBackupKey('formBuilder', null)).toBe('alga.formBuilder.draftBackup.new');
  });

  it('round-trips a backup and clears it', () => {
    const backup = {
      definition: { title: 'edited' },
      baseDefinition: { title: 'saved' },
      savedAt: '2026-03-02T10:00:00.000Z',
    };
    writeDesignerDraftBackup('formBuilder', 'def-1', backup);
    expect(readDesignerDraftBackup<Doc>('formBuilder', 'def-1')).toEqual(backup);

    clearDesignerDraftBackup('formBuilder', 'def-1');
    expect(readDesignerDraftBackup<Doc>('formBuilder', 'def-1')).toBeNull();
  });

  it('ignores stored junk rather than offering a broken restore', () => {
    window.localStorage.setItem(designerDraftBackupKey('formBuilder', 'def-1'), 'not json');
    expect(readDesignerDraftBackup<Doc>('formBuilder', 'def-1')).toBeNull();

    window.localStorage.setItem(
      designerDraftBackupKey('formBuilder', 'def-2'),
      JSON.stringify({ definition: { title: 'x' } })
    );
    expect(readDesignerDraftBackup<Doc>('formBuilder', 'def-2')).toBeNull();
  });

  it('offers a restore only when it holds edits made on top of what is saved now', () => {
    const saved: Doc = { title: 'saved' };

    expect(
      shouldOfferDesignerDraftBackup(
        { definition: { title: 'edited' }, baseDefinition: saved, savedAt: 'x' },
        saved,
        same
      )
    ).toBe(true);
    // Nothing was actually changed.
    expect(
      shouldOfferDesignerDraftBackup(
        { definition: saved, baseDefinition: saved, savedAt: 'x' },
        saved,
        same
      )
    ).toBe(false);
    // The draft moved on since the backup: restoring would bury newer work.
    expect(
      shouldOfferDesignerDraftBackup(
        { definition: { title: 'edited' }, baseDefinition: { title: 'older' }, savedAt: 'x' },
        saved,
        same
      )
    ).toBe(false);
    expect(shouldOfferDesignerDraftBackup(null, saved, same)).toBe(false);
  });
});

describe('designer palette search', () => {
  it('matches every word of the query as a prefix, in any order', () => {
    expect(matchesDesignerPaletteQuery('Date and time', 'time date')).toBe(true);
    expect(matchesDesignerPaletteQuery('Date and time', 'dat')).toBe(true);
    expect(matchesDesignerPaletteQuery('Date and time', 'phone')).toBe(false);
    // An empty query matches everything, so the grid stays whole.
    expect(matchesDesignerPaletteQuery('Date and time', '   ')).toBe(true);
  });

  it('forgives singular and plural, and camelCase', () => {
    expect(matchesDesignerPaletteQuery('Date and time', 'dates')).toBe(true);
    expect(matchesDesignerPaletteQuery('Choose several', 'choices')).toBe(false);
    expect(matchesDesignerPaletteQuery('multiSelect', 'select')).toBe(true);
  });

  it('orders categories as asked and the rest alphabetically', () => {
    const grouped = groupDesignerPaletteItemsByCategory(
      [
        { category: 'layout', label: 'Divider' },
        { category: 'text', label: 'Long text' },
        { category: 'zebra', label: 'Stripes' },
        { category: 'text', label: 'Short text', sortOrder: -1 },
        { category: 'aardvark', label: 'Ants' },
      ],
      ['text', 'layout']
    );

    expect(Object.keys(grouped)).toEqual(['text', 'layout', 'aardvark', 'zebra']);
    // sortOrder wins over the label.
    expect(grouped.text.map((item) => item.label)).toEqual(['Short text', 'Long text']);
  });
});

describe('designer sidebar sizing', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('keeps the panel between its bounds', () => {
    expect(clampDesignerSidebarWidth(10)).toBe(MIN_DESIGNER_SIDEBAR_WIDTH);
    expect(clampDesignerSidebarWidth(5000)).toBe(MAX_DESIGNER_SIDEBAR_WIDTH);
    expect(clampDesignerSidebarWidth(420.4)).toBe(420);
  });

  it('widens as the drag moves left', () => {
    expect(getDesignerSidebarWidthFromDrag(420, 900, 800)).toBe(520);
    expect(getDesignerSidebarWidthFromDrag(420, 900, 1000)).toBe(MIN_DESIGNER_SIDEBAR_WIDTH);
  });

  it('toggles between the default and the roomy width', () => {
    expect(toggleDesignerSidebarWidth(DEFAULT_DESIGNER_SIDEBAR_WIDTH)).toBe(
      WIDE_DESIGNER_SIDEBAR_WIDTH
    );
    expect(toggleDesignerSidebarWidth(WIDE_DESIGNER_SIDEBAR_WIDTH)).toBe(
      DEFAULT_DESIGNER_SIDEBAR_WIDTH
    );
  });

  it('remembers a width per namespace, and falls back when there is none', () => {
    expect(readStoredDesignerSidebarWidth('formBuilder')).toBe(DEFAULT_DESIGNER_SIDEBAR_WIDTH);

    storeDesignerSidebarWidth('formBuilder', 5000);
    expect(readStoredDesignerSidebarWidth('formBuilder')).toBe(MAX_DESIGNER_SIDEBAR_WIDTH);
    expect(readStoredDesignerSidebarWidth('workflowDesigner')).toBe(
      DEFAULT_DESIGNER_SIDEBAR_WIDTH
    );
  });
});
