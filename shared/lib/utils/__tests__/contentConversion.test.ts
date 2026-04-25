import { describe, expect, it } from 'vitest';
import { convertHtmlToBlockNote } from '../contentConversion';

function textFromBlock(block: any): string {
  const content = Array.isArray(block.content) ? block.content : [];
  return content.map((item: any) => item.text ?? '').join('');
}

describe('convertHtmlToBlockNote email table handling', () => {
  it('preserves table blocks by default', async () => {
    const result = await convertHtmlToBlockNote(`
      <table>
        <tr><td>Name</td><td>Ada Lovelace</td></tr>
        <tr><td>Business Email Address</td><td>ada@example.com</td></tr>
      </table>
    `);

    expect(result.some((block) => block.type === 'table')).toBe(true);
  });

  it('preserves normal data tables as BlockNote table blocks even when email table cleanup is enabled', async () => {
    const result = await convertHtmlToBlockNote(`
      <table>
        <tr><th>Name</th><th>Email</th></tr>
        <tr><td>Ada Lovelace</td><td>ada@example.com</td></tr>
        <tr><td>Grace Hopper</td><td>grace@example.com</td></tr>
      </table>
    `, { flattenTables: true });

    const tableBlock = result.find((block) => block.type === 'table');
    expect(tableBlock).toBeDefined();
    expect((tableBlock?.content as any)?.rows).toHaveLength(3);
    expect((tableBlock?.content as any)?.rows[0].cells).toHaveLength(2);
  });

  it('splits collapsed nested layout-table content into label/value paragraphs', async () => {
    const result = await convertHtmlToBlockNote(`
      <table>
        <tr><td>
          <h2>Entry Details</h2>
          <table><tr><td>
            <h2>Tools &amp; Resources</h2>
            <table>
              <tr><td><p><b>Name</b></p></td><td><p>Ada Lovelace</p></td></tr>
              <tr><td><p><b>Business Email Address</b></p></td><td><p>ada@example.com</p></td></tr>
              <tr><td><p><b>Description of Issue</b></p></td><td><p>Requesting a call back.</p></td></tr>
            </table>
          </td></tr></table>
        </td></tr>
      </table>
    `, { flattenTables: true });

    expect(result.every((block) => block.type === 'paragraph')).toBe(true);
    expect(result.map(textFromBlock)).toContain('Name Ada Lovelace');
    expect(result.map(textFromBlock)).toContain('Business Email Address ada@example.com');
    expect(result.map(textFromBlock)).toContain('Description of Issue Requesting a call back.');
  });
});
