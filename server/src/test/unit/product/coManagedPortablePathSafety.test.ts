import { describe, expect, it } from 'vitest';
import { coManagedPortableNativeFilePath } from '../../../../../packages/co-managed/src/portableNativeFilePath';
import { CoManagedSharedWorkError } from '../../../../../packages/co-managed/src/sharedWorkIdentity';

const T = '11111111-1111-4111-8111-111111111111', OTHER = '99999999-9999-4999-8999-999999999999';

describe('portable native file path safety', () => {
  it.each([`${T}/a/b.bin`, `/${T}/a.bin`, `pdfs/${T}/x.pdf`])('accepts the owner-scoped path %s', path => {
    expect(coManagedPortableNativeFilePath(T, path)).toBe(path);
  });
  it.each([
    ['traversal', `${T}/../${OTHER}/a`], ['leading traversal', `../${T}/a`], ['other tenant', `${OTHER}/a.bin`], ['other tenant pdf', `pdfs/${OTHER}/x.pdf`],
    ['dot segment', `${T}/./a`], ['empty segment', `${T}//a`], ['backslash', `${T}\\a`], ['nul byte', `${T}/a\u0000b`], ['control char', `${T}/a\nb`],
    ['tenant only', T], ['absolute escape', `/etc/passwd`], ['non-string', 42 as any],
  ])('rejects %s', (_name, path) => {
    expect(() => coManagedPortableNativeFilePath(T, path)).toThrow(CoManagedSharedWorkError);
  });
});
