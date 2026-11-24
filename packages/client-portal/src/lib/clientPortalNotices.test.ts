import { describe, expect, it } from 'vitest';
import {
  getNoticeStatus,
  isAllowedNoticeLinkUrl,
  isNoticeDismissible,
  isNoticeLive,
  normalizeNoticeInput,
  resolveNoticeContent,
  validateNoticeInput,
  NOTICE_LINK_LABEL_MAX_LENGTH,
  NOTICE_MESSAGE_MAX_LENGTH,
} from './clientPortalNotices';

const base = {
  severity: 'info',
  content: { default: { message: 'Hello' } },
  dismissible: true,
  audience_type: 'all',
};
const paths = (input: unknown) => validateNoticeInput(input).errors.map((e) => `${e.path}:${e.code}`);

describe('T009 validation', () => {
  it('accepts a minimal valid notice', () => {
    expect(validateNoticeInput(base)).toEqual({ valid: true, errors: [] });
  });

  it.each([
    'javascript:alert(1)', ' JavaScript:alert(1)', 'JAVASCRIPT:alert(1)', 'java\tscript:alert(1)',
    'data:text/html,x', 'vbscript:x', 'http://example.com', '//evil.com', '/\\evil.com', '\\\\evil.com',
    '/\t/evil.com', 'https://', 'https://user:pw@example.com', ' https://example.com', 'example.com',
    'https://exa\nmple.com', 'mailto:a@b.c', '',
  ])('rejects link %j', (url) => {
    expect(isAllowedNoticeLinkUrl(url)).toBe(false);
  });

  it.each(['https://example.com', 'HTTPS://example.com/a?b=1#c', '/', '/tickets/123?x=1', 'https://a.b/%2F'])(
    'accepts link %j', (url) => {
      expect(isAllowedNoticeLinkUrl(url)).toBe(true);
    });

  it('treats an absent link as valid and flags bad ones at link_url', () => {
    expect(validateNoticeInput({ ...base, link_url: null }).valid).toBe(true);
    expect(validateNoticeInput({ ...base, link_url: '' }).valid).toBe(true);
    expect(paths({ ...base, link_url: 'javascript:alert(1)' })).toEqual(['link_url:invalid_url']);
  });

  it('rejects a link label without a URL', () => {
    expect(paths({ ...base, content: { default: { message: 'x', linkLabel: 'Go' } } }))
      .toEqual(['link_url:link_label_requires_url']);
    expect(validateNoticeInput({ ...base, link_url: '/x', content: { default: { message: 'x', linkLabel: 'Go' } } }).valid).toBe(true);
  });

  it('rejects end before or equal to start, accepts after', () => {
    const s = '2026-01-02T00:00:00Z';
    expect(paths({ ...base, starts_at: s, ends_at: '2026-01-01T00:00:00Z' })).toEqual(['ends_at:ends_before_start']);
    expect(paths({ ...base, starts_at: s, ends_at: s })).toEqual(['ends_at:ends_before_start']);
    expect(validateNoticeInput({ ...base, starts_at: s, ends_at: '2026-01-03T00:00:00Z' }).valid).toBe(true);
    expect(validateNoticeInput({ ...base, ends_at: s }).valid).toBe(true);
    expect(paths({ ...base, starts_at: 'garbage' })).toEqual(['starts_at:invalid_date']);
  });

  it('enforces message length at the boundary, per locale', () => {
    const msg = (n: number) => 'a'.repeat(n);
    expect(validateNoticeInput({ ...base, content: { default: { message: msg(NOTICE_MESSAGE_MAX_LENGTH) } } }).valid).toBe(true);
    expect(paths({ ...base, content: { default: { message: msg(501) } } })).toEqual(['content.default.message:too_long']);
    expect(paths({ ...base, content: { default: { message: 'ok' }, fr: { message: msg(501) } } }))
      .toEqual(['content.fr.message:too_long']);
  });

  it('enforces link label length at the boundary, per locale', () => {
    const label = (n: number) => 'a'.repeat(n);
    const withLabel = (n: number) => ({ ...base, link_url: '/x', content: { default: { message: 'x', linkLabel: label(n) } } });
    expect(validateNoticeInput(withLabel(NOTICE_LINK_LABEL_MAX_LENGTH)).valid).toBe(true);
    expect(paths(withLabel(61))).toEqual(['content.default.linkLabel:too_long']);
    expect(paths({ ...base, link_url: '/x', content: { default: { message: 'x' }, de: { message: 'y', linkLabel: label(61) } } }))
      .toEqual(['content.de.linkLabel:too_long']);
  });

  it('requires a non-blank default message and valid enums', () => {
    expect(paths({ ...base, content: { default: { message: '   ' } } })).toEqual(['content.default.message:required']);
    expect(paths({ ...base, content: { fr: { message: 'x' } } })).toContain('content.default.message:required');
    expect(paths({ ...base, severity: 'bad', audience_type: 'nope' })).toEqual(['severity:invalid_value', 'audience_type:invalid_value']);
    expect(paths({ ...base, content: { default: { message: 'x' }, zz: { message: 'y' } } })).toEqual(['content.zz:unsupported_locale']);
    expect(paths(null)).toEqual([':invalid_type']);
  });

  it('requires non-empty lists for clients/tags audiences', () => {
    expect(paths({ ...base, audience_type: 'clients' })).toEqual(['audience_client_ids:audience_empty']);
    expect(paths({ ...base, audience_type: 'tags', audience_tag_ids: [] })).toEqual(['audience_tag_ids:audience_empty']);
    expect(validateNoticeInput({ ...base, audience_type: 'tags', audience_tag_ids: ['t1'] }).valid).toBe(true);
    expect(validateNoticeInput({ ...base, audience_type: 'all', audience_client_ids: [] }).valid).toBe(true);
  });
});

describe('T010 locale resolution', () => {
  const content = {
    default: { message: 'Maintenance', linkLabel: 'Details' },
    fr: { message: 'Maintenance FR', linkLabel: 'Détails' },
    de: { message: 'Wartung' },
  };

  it('uses the translated locale when present', () => {
    expect(resolveNoticeContent(content, 'fr')).toEqual({ locale: 'fr', message: 'Maintenance FR', linkLabel: 'Détails' });
    expect(resolveNoticeContent(content, 'fr-CA').message).toBe('Maintenance FR');
  });

  it('falls back to default when the locale is missing, unknown or absent', () => {
    for (const l of ['es', 'xx-unknown', '', null, undefined]) {
      expect(resolveNoticeContent(content, l)).toEqual({ locale: 'default', message: 'Maintenance', linkLabel: 'Details' });
    }
  });

  it('falls back to the default label when the locale has none', () => {
    expect(resolveNoticeContent(content, 'de')).toEqual({ locale: 'de', message: 'Wartung', linkLabel: 'Details' });
  });

  it('ignores a blank translated message', () => {
    expect(resolveNoticeContent({ default: { message: 'D' }, fr: { message: '  ' } }, 'fr').locale).toBe('default');
  });
});

describe('liveness and status', () => {
  const n = { starts_at: '2026-06-01T00:00:00Z', ends_at: new Date('2026-06-02T00:00:00Z') };
  const at = (s: string) => new Date(s);

  it('is scheduled before start, live exactly at start, expired exactly at end', () => {
    expect(getNoticeStatus(n, at('2026-05-31T23:59:59.999Z'))).toBe('scheduled');
    expect(getNoticeStatus(n, at('2026-06-01T00:00:00Z'))).toBe('live');
    expect(getNoticeStatus(n, at('2026-06-01T23:59:59.999Z'))).toBe('live');
    expect(getNoticeStatus(n, at('2026-06-02T00:00:00Z'))).toBe('expired');
    expect(isNoticeLive(n, at('2026-06-01T00:00:00Z'))).toBe(true);
    expect(isNoticeLive(n, at('2026-06-02T00:00:00Z'))).toBe(false);
    expect(isNoticeLive(n, at('2026-05-31T00:00:00Z'))).toBe(false);
  });

  it('treats missing bounds as open', () => {
    expect(getNoticeStatus({}, at('2030-01-01'))).toBe('live');
    expect(getNoticeStatus({ starts_at: null, ends_at: null }, at('2030-01-01'))).toBe('live');
    expect(getNoticeStatus({ ends_at: '2026-01-01T00:00:00Z' }, at('2026-01-02'))).toBe('expired');
    expect(getNoticeStatus({ starts_at: '2027-01-01T00:00:00Z' }, at('2026-01-02'))).toBe('scheduled');
  });
});

describe('critical is never dismissible', () => {
  it('normalizes and reads back false for critical regardless of the flag', () => {
    expect(normalizeNoticeInput({ severity: 'critical', dismissible: true }).dismissible).toBe(false);
    expect(isNoticeDismissible({ severity: 'critical', dismissible: true })).toBe(false);
  });
  it('leaves other severities untouched', () => {
    expect(normalizeNoticeInput({ severity: 'warning', dismissible: true }).dismissible).toBe(true);
    expect(isNoticeDismissible({ severity: 'info', dismissible: true })).toBe(true);
    expect(isNoticeDismissible({ severity: 'info', dismissible: false })).toBe(false);
  });
});
