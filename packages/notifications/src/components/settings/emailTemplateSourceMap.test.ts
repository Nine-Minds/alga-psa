import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  annotateHtmlSource,
  collectHtmlSourceTags,
  findRangeAtOffset,
  parseSourceRange,
  SOURCE_RANGE_ATTRIBUTE,
} from './emailTemplateSourceMap';

const templatesSource = readFileSync(resolve(__dirname, 'EmailTemplates.tsx'), 'utf8');
const previewSource = readFileSync(resolve(__dirname, 'EmailTemplatePreview.tsx'), 'utf8');

const rangeText = (html: string, index: number) => {
  const { start, end } = collectHtmlSourceTags(html)[index];
  return html.slice(start, end);
};

describe('collectHtmlSourceTags', () => {
  it('spans each element from its open tag to its close tag', () => {
    const html = '<div><p>Hello</p></div>';

    expect(collectHtmlSourceTags(html)).toEqual([
      { start: 0, end: 23 },
      { start: 5, end: 17 },
    ]);
    expect(rangeText(html, 1)).toBe('<p>Hello</p>');
  });

  it('ends void and self-closed elements at their own tag', () => {
    const html = '<p>a<br>b<img src="x" />c</p>';

    expect(rangeText(html, 1)).toBe('<br>');
    expect(rangeText(html, 2)).toBe('<img src="x" />');
  });

  it('is not fooled by angle brackets inside attribute values', () => {
    const html = '<a title="1 > 0">go</a>';

    expect(collectHtmlSourceTags(html)).toEqual([{ start: 0, end: 23 }]);
  });

  it('ignores markup inside comments and raw-text elements', () => {
    const html = '<div><!-- <span>x</span> --><style>a{content:"<b>"}</style></div>';
    const tags = collectHtmlSourceTags(html);

    expect(tags).toHaveLength(2);
    expect(rangeText(html, 1)).toBe('<style>a{content:"<b>"}</style>');
  });

  it('closes an unclosed inner element at its own tag instead of swallowing the rest', () => {
    const html = '<td><p>one<td>two</td>';
    const tags = collectHtmlSourceTags(html);

    expect(html.slice(tags[1].start, tags[1].end)).toBe('<p>');
  });
});

describe('annotateHtmlSource', () => {
  it('stamps every open tag with the range and leaves the text alone', () => {
    expect(annotateHtmlSource('<div><p>Hi {{name}}</p></div>')).toBe(
      `<div ${SOURCE_RANGE_ATTRIBUTE}="0:29"><p ${SOURCE_RANGE_ATTRIBUTE}="5:23">Hi {{name}}</p></div>`,
    );
  });

  it('keeps existing attributes and returns plain text unchanged', () => {
    expect(annotateHtmlSource('<a href="{{url}}">x</a>')).toContain(`<a ${SOURCE_RANGE_ATTRIBUTE}="0:23" href="{{url}}">`);
    expect(annotateHtmlSource('no markup here')).toBe('no markup here');
  });

  it('stamps offsets that address the original source, not the annotated copy', () => {
    const html = '<div><span>x</span></div>';
    const annotated = annotateHtmlSource(html);
    const marker = annotated.match(new RegExp(`<span ${SOURCE_RANGE_ATTRIBUTE}="(\\d+):(\\d+)"`))!;

    expect(html.slice(Number(marker[1]), Number(marker[2]))).toBe('<span>x</span>');
  });
});

describe('parseSourceRange', () => {
  it('reads a marker back', () => {
    expect(parseSourceRange('4:12')).toEqual({ start: 4, end: 12 });
  });

  it('rejects anything that is not a forward range', () => {
    expect(parseSourceRange(null)).toBeNull();
    expect(parseSourceRange('')).toBeNull();
    expect(parseSourceRange('nope')).toBeNull();
    expect(parseSourceRange('9:2')).toBeNull();
  });
});

describe('findRangeAtOffset', () => {
  const ranges = [{ start: 0, end: 30 }, { start: 5, end: 20 }, { start: 8, end: 12 }];

  it('picks the innermost element containing the caret', () => {
    expect(findRangeAtOffset(ranges, 10)).toEqual({ start: 8, end: 12 });
    expect(findRangeAtOffset(ranges, 18)).toEqual({ start: 5, end: 20 });
    expect(findRangeAtOffset(ranges, 25)).toEqual({ start: 0, end: 30 });
  });

  it('returns nothing when the caret is outside every element', () => {
    expect(findRangeAtOffset(ranges, 31)).toBeNull();
    expect(findRangeAtOffset([], 0)).toBeNull();
  });
});

describe('side-by-side editor', () => {
  it('keeps the source and the preview on screen together', () => {
    const dialog = templatesSource.slice(templatesSource.indexOf('function EditTemplateDialog'));

    expect(dialog).toContain('lg:grid-cols-2');
    expect(dialog).toContain('id="html-content"');
    expect(dialog).toContain('id="edit-template-preview"');
    // The source is no longer hidden behind a tab, and the text body stays visible with it.
    expect(dialog).not.toContain('<TabsTrigger value="source">');
    expect(dialog).not.toContain("htmlTab !== 'preview'");
    expect(dialog).toContain('id="text-content"');
  });

  it('toggles the right pane between the preview and the variables', () => {
    const dialog = templatesSource.slice(templatesSource.indexOf('function EditTemplateDialog'));

    expect(dialog).toContain('<Tabs value={sidePanel} onValueChange={setSidePanel}>');
    expect(dialog).toContain('<TabsTrigger value="preview">');
    expect(dialog).toContain('<TabsTrigger value="variables">');
    expect(dialog).toContain('<TemplateVariablePanel');
  });

  it('follows the draft one pause behind instead of on every keystroke', () => {
    expect(templatesSource).toContain('useDebouncedValue(formData.html_content');
    expect(templatesSource).toContain('htmlContent={previewHtml}');
  });

  it('wires both directions of the source highlight', () => {
    expect(templatesSource).toContain('highlightOffset={caretOffset}');
    expect(templatesSource).toContain('onSelectSource={selectSourceRange}');
    expect(templatesSource).toContain('element.setSelectionRange(range.start, range.end)');
    expect(previewSource).toContain('annotateHtmlSource(htmlContent) : htmlContent');
    expect(previewSource).toContain("closest?.(`[${SOURCE_RANGE_ATTRIBUTE}]`)");
  });

  it('leaves every other preview untouched', () => {
    expect(previewSource).toContain('sourceMap?: boolean;');
    expect(previewSource).toContain('if (!sourceMap) return;');
  });
});
