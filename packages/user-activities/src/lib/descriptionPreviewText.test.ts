import { describe, expect, it } from 'vitest';
import { descriptionPreviewText } from './descriptionPreviewText';

// A synced Outlook event body, stored verbatim by calendar sync.
const outlookBody = [
  '<html><head>',
  '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
  '<style type="text/css" style="display:none">',
  '<!-- p.MsoNormal { margin:0; font-family:"Aptos",sans-serif; font-size:12pt } -->',
  '</style>',
  '</head>',
  '<body dir="ltr"><div class="elementToProof">',
  '<p class="MsoNormal">Quarterly review with Acme &amp; Sons</p>',
  '<p class="MsoNormal">Bring the renewal&nbsp;quote &#8212; room 3</p>',
  '</div></body></html>',
].join('');

describe('descriptionPreviewText', () => {
  it('reduces a synced Outlook body to its text', () => {
    expect(descriptionPreviewText(outlookBody)).toBe(
      'Quarterly review with Acme & Sons Bring the renewal quote — room 3',
    );
  });

  it('drops head, style and comment contents entirely', () => {
    const preview = descriptionPreviewText(outlookBody);
    expect(preview).not.toMatch(/font-family|MsoNormal|charset|<|>/);
  });

  it('leaves plain text untouched', () => {
    for (const plain of [
      'Onsite visit: replace the switch in rack 2',
      'Budget < 500 & scope > last year',
      'Call 10 a.m.\nThen email the quote',
    ]) {
      expect(descriptionPreviewText(plain)).toBe(plain);
    }
  });

  it('returns empty for missing or markup-only bodies so the card falls back', () => {
    expect(descriptionPreviewText(undefined)).toBe('');
    expect(descriptionPreviewText('')).toBe('');
    expect(descriptionPreviewText('<html><head><style>p { color: red }</style></head><body><p></p></body></html>')).toBe('');
    expect(descriptionPreviewText('<div><br></div>')).toBe('');
  });

  it('keeps block boundaries as whitespace and collapses the rest', () => {
    expect(descriptionPreviewText('<p>One</p><p>Two</p>')).toBe('One Two');
    expect(descriptionPreviewText('<div>Line one<br>Line two</div>')).toBe('Line one Line two');
    expect(descriptionPreviewText('<table><tr><td>A</td><td>B</td></tr></table>')).toBe('A B');
    expect(descriptionPreviewText('<p>Spaced   out\n\n  text</p>')).toBe('Spaced out text');
  });

  it('decodes entities once, without re-reading the result as markup', () => {
    expect(descriptionPreviewText('<p>&amp;lt;p&amp;gt; is literal</p>')).toBe('&lt;p&gt; is literal');
    expect(descriptionPreviewText('<p>&quot;quoted&quot; &apos;tick&apos; &#39;&#x2014;</p>'))
      .toBe('"quoted" \'tick\' \'—');
    expect(descriptionPreviewText('<p>&unknownentity; stays</p>')).toBe('&unknownentity; stays');
  });
});
