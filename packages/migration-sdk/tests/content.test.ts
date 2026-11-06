import { describe, expect, it } from 'vitest';
import { ampContentUri, parseAmpContentUri } from '@alga-psa/migration-spec';
import { rewriteAmpContent } from '../src/index';

describe('semantic AMP content references', () => {
  const uri = ampContentUri({ entityType: 'files', packageRecordId: 'file:/opaque % identity', representation: 'download', fragment: '#page=2' });
  it('round trips opaque identities without allowing a package to name a native path', () => {
    expect(parseAmpContentUri(uri)).toEqual({ entityType: 'files', packageRecordId: 'file:/opaque % identity', representation: 'download', fragment: '#page=2' });
    expect(parseAmpContentUri(ampContentUri({ entityType: 'files', packageRecordId: '..', representation: 'view' }))?.packageRecordId).toBe('..');
    expect(parseAmpContentUri('https://example.invalid/image')).toBeNull();
    for (const invalid of ['amp://files/a/download?token=secret', 'amp://files/../../etc/passwd', 'amp://files/a/execute', 'amp://user:secret@files/a/download']) expect(() => parseAmpContentUri(invalid)).toThrow();
  });
  it('rewrites Markdown and HTML links and media without touching code or prose', () => {
    const input = `[guide](${uri})\n<img src="${uri}">\n\n\`${uri}\`\n\n\`\`\`html\n<img src="${uri}">\n\`\`\`\nordinary ${uri}`;
    const output = rewriteAmpContent(input, url => url === uri ? '/target/file' : url) as string;
    expect(output).toContain('[guide](/target/file)');
    expect(output).toContain('<img src="/target/file">');
    expect(output).toContain(`\`${uri}\``);
    expect(output).toContain(`\`\`\`html\n<img src="${uri}">\n\`\`\``);
    expect(output).toContain(`ordinary ${uri}`);
  });
  it('rewrites Tiptap and BlockNote semantic slots while retaining text and metadata', () => {
    const input = [{ type: 'image', props: { url: uri, caption: uri } }, { type: 'paragraph', content: [{ type: 'link', href: uri, content: 'guide' }, { type: 'text', text: uri }] }, { type: 'codeBlock', content: [{ type: 'link', href: uri }] }];
    const output = JSON.parse(rewriteAmpContent(JSON.stringify(input), url => url === uri ? '/target/file' : url) as string);
    expect(output[0].props).toEqual({ url: '/target/file', caption: uri });
    expect(output[1].content[0].href).toBe('/target/file');
    expect(output[1].content[1].text).toBe(uri);
    expect(output[2].content[0].href).toBe(uri);
    const doc = { type: 'doc', content: [{ type: 'image', attrs: { src: uri } }, { type: 'text', text: 'guide', marks: [{ type: 'link', attrs: { href: uri } }] }] };
    expect(rewriteAmpContent(doc, () => '/target/file')).toMatchObject({ content: [{ attrs: { src: '/target/file' } }, { marks: [{ attrs: { href: '/target/file' } }] }] });
  });
});
