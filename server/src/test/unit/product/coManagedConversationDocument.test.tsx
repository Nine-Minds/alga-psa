/** @vitest-environment jsdom */
import React from 'react';
import { fr } from '@blocknote/core/locales';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import Document from '../../../components/co-managed/CoManagedConversationDocument';
import { snapshotConversationDocument } from '../../../../../packages/co-managed/src/conversationRichText';
const context = vi.hoisted(() => ({ theme: 'dark', locale: 'en' }));
vi.mock('@alga-psa/ui/hooks/useAppTheme', () => ({ useAppTheme: () => ({ resolvedTheme: context.theme }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useOptionalI18n: () => ({ locale: context.locale }) }));
beforeEach(() => { context.theme = 'dark'; context.locale = 'en'; });
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(cleanup);
it.each(['light', 'dark'])('renders actual BlockNote styles and literal text in %s without markdown reinterpretation', async theme => {
  context.theme = theme;
  const blocks = snapshotConversationDocument([{ type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Heading', styles: { bold: true } }] },
    { type: 'paragraph', content: [{ type: 'text', text: '**literal** <img src=x>', styles: {} }, { type: 'link', href: 'https://example.test/', content: [{ type: 'text', text: 'Link', styles: {} }] }] }]);
  const view = render(<Document id="rich-view" document={blocks} />);
  await screen.findByText('Heading'); expect(view.container.querySelector('.bn-container')).toHaveAttribute('data-color-scheme', theme); expect(view.container.querySelector('h2 strong')).not.toBeNull();
  expect(view.container.textContent).toContain('**literal** <img src=x>'); expect(view.container.querySelector('img')).toBeNull();
  expect(view.container.querySelector('a')?.getAttribute('href')).toBe('https://example.test/');
  expect(view.container.querySelector('[contenteditable="true"]')).toBeNull();
});
it('retains nested lists and tables in the actual editable schema and freezes the same editor on uncertain outcomes', async () => {
  const blocks = snapshotConversationDocument([{ type: 'bulletListItem', content: [{ type: 'text', text: 'Parent', styles: {} }], children: [{ type: 'paragraph', content: [{ type: 'text', text: 'Child', styles: {} }] }] },
    { type: 'table', content: { type: 'tableContent', rows: [{ cells: [[{ type: 'text', text: 'Cell', styles: {} }]] }] } }]);
  const view = render(<Document id="rich-editor" label="Message" document={blocks} editable />);
  await screen.findByText('Child'); expect(view.container.querySelector('table')).not.toBeNull();
  expect(view.container.querySelector('[contenteditable="true"]')).not.toBeNull();
  view.rerender(<Document id="rich-editor" label="Message" document={blocks} editable={false} />);
  await waitFor(() => expect(view.container.querySelector('[contenteditable="true"]')).toBeNull());
  expect(view.container.textContent).toContain('Parent'); expect(view.container.textContent).toContain('Cell');
});

it.each(['fr', 'xx', 'yy'])('uses the editor dictionary for %s without translating authored content', async locale => {
  context.locale = locale;
  const view = render(<Document id="localized-editor" label="Message" document={[]} editable />);
  const editor = view.container.querySelector('#localized-editor-input')!;
  const selector = Array.from(editor.classList).find(value => value.startsWith('placeholder-selector-'))!;
  const placeholder = Array.from(document.styleSheets).flatMap(sheet => Array.from(sheet.cssRules)).map(rule => rule.cssText).filter(rule => rule.includes(selector)).join('\n');
  if (locale === 'fr') expect(placeholder).toContain(fr.placeholders.emptyDocument);
  else expect(placeholder).toContain(locale === 'xx' ? '111' : '222');
  expect(view.container.querySelector('#localized-editor-input')).toHaveAttribute('aria-labelledby', 'localized-editor-label');
});
