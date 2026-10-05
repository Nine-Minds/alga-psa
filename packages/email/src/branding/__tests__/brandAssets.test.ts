import { describe, expect, it } from 'vitest';
import {
  applyBrandLogo,
  brandLogoCid,
  containsBrandAttribution,
  decorateBrandedHtml,
  findBrandLogoCid,
  parseBrandLogoVariant,
  pickBrandLogoVariant,
  resolveBrandLogoForPreview,
  stripBrandAttribution,
  withImgSrc,
  BRAND_LOGO_CIDS,
  BRAND_LOGO_MARKER,
} from '../brandAssets';
import { isDarkEmailHeader } from '../color';
import { loadSystemTemplate } from './systemTemplateFixtures';

const LOGO = { variant: 'wide' as const, alt: 'Acme MSP' };

const countLogos = (html: string) => (html.match(new RegExp(BRAND_LOGO_MARKER, 'g')) ?? []).length;

describe('applyBrandLogo', () => {
  it('puts the logo inside the gradient header cell of a layout template', () => {
    const template = loadSystemTemplate('ticket-created');
    const branded = applyBrandLogo(template.html, LOGO);

    const headerCell = /<td\b[^>]*linear-gradient\([^>]*>([\s\S]*?)<\/td>/i.exec(branded)!;
    expect(headerCell[1]).toContain(BRAND_LOGO_MARKER);
    expect(headerCell[1].indexOf(BRAND_LOGO_MARKER)).toBeLessThan(headerCell[1].indexOf('text-transform:uppercase'));
    expect(branded).toContain('max-height:40px');
    expect(branded).toContain('alt="Acme MSP"');
    expect(branded).toContain('src="cid:alga-brand-logo-wide"');
  });

  it('puts the logo before the first heading of an auth template', () => {
    const template = loadSystemTemplate('password-reset');
    const branded = applyBrandLogo(template.html, LOGO);

    expect(branded).not.toMatch(/<td\b[^>]*linear-gradient\([^>]*>[\s\S]*data-alga-brand-logo/i);
    expect(branded.indexOf(BRAND_LOGO_MARKER)).toBeLessThan(branded.indexOf('<h1'));
    expect(countLogos(branded)).toBe(1);
  });

  it('replaces its own image instead of adding a second one', () => {
    const template = loadSystemTemplate('ticket-created');
    const once = applyBrandLogo(template.html, LOGO);
    const twice = applyBrandLogo(once, { variant: 'default', alt: 'Acme MSP' });

    expect(countLogos(twice)).toBe(1);
    expect(twice).toContain('src="cid:alga-brand-logo"');
    expect(twice).not.toContain('alga-brand-logo-wide');
  });

  it('escapes the alt text', () => {
    const branded = applyBrandLogo('<body><h1>Hi</h1></body>', {
      variant: 'default',
      alt: 'Acme "MSP" <Ltd>',
    });

    expect(branded).toContain('alt="Acme &quot;MSP&quot; &lt;Ltd&gt;"');
  });
});

describe('brand logo content-ids', () => {
  it('gives every variant, dark artwork included, its own content-id', () => {
    expect(BRAND_LOGO_CIDS).toEqual({
      default: 'alga-brand-logo',
      dark: 'alga-brand-logo-dark',
      wide: 'alga-brand-logo-wide',
      'wide-dark': 'alga-brand-logo-wide-dark',
    });
    expect(new Set(Object.values(BRAND_LOGO_CIDS)).size).toBe(4);
  });

  it('round-trips each variant through its cid', () => {
    for (const variant of Object.keys(BRAND_LOGO_CIDS) as (keyof typeof BRAND_LOGO_CIDS)[]) {
      expect(parseBrandLogoVariant(`cid:${brandLogoCid(variant)}`)).toBe(variant);
    }
  });

  it('does not read the wide-dark cid as the wide one', () => {
    expect(parseBrandLogoVariant('cid:alga-brand-logo-wide-dark')).toBe('wide-dark');
    expect(findBrandLogoCid(applyBrandLogo('<body><h1>Hi</h1></body>', { variant: 'wide-dark' })))
      .toBe('alga-brand-logo-wide-dark');
  });
});

describe('pickBrandLogoVariant', () => {
  const ALL = {
    logoUrl: '/square',
    logoDarkUrl: '/square-dark',
    logoWideUrl: '/wide',
    logoWideDarkUrl: '/wide-dark',
  };

  it('takes the dark artwork of the chosen shape onto a dark header', () => {
    expect(pickBrandLogoVariant('wide', true, ALL)).toBe('wide-dark');
    expect(pickBrandLogoVariant('default', true, ALL)).toBe('dark');
  });

  it('keeps the light artwork on a light header', () => {
    expect(pickBrandLogoVariant('wide', false, ALL)).toBe('wide');
    expect(pickBrandLogoVariant('default', false, ALL)).toBe('default');
  });

  it('settles for the light artwork when no dark one was uploaded', () => {
    expect(pickBrandLogoVariant('wide', true, { logoUrl: ALL.logoUrl, logoWideUrl: ALL.logoWideUrl }))
      .toBe('wide');
    expect(pickBrandLogoVariant('default', true, { logoUrl: ALL.logoUrl })).toBe('default');
  });

  it('falls back to the square shape when no wordmark was uploaded', () => {
    expect(pickBrandLogoVariant('wide', true, { logoUrl: ALL.logoUrl, logoDarkUrl: ALL.logoDarkUrl }))
      .toBe('dark');
    expect(pickBrandLogoVariant('wide', false, { logoUrl: ALL.logoUrl })).toBe('default');
  });

  it('takes a dark-only upload of the chosen shape', () => {
    expect(pickBrandLogoVariant('wide', true, { logoWideDarkUrl: ALL.logoWideDarkUrl })).toBe('wide-dark');
  });

  it('names no variant when nothing usable is uploaded', () => {
    expect(pickBrandLogoVariant('wide', true, {})).toBeNull();
    expect(pickBrandLogoVariant('default', false, { logoDarkUrl: ALL.logoDarkUrl })).toBeNull();
  });

  it('agrees with the header the palette paints', () => {
    // The AlgaPSA purple header is dark; a pastel one is not.
    expect(pickBrandLogoVariant('wide', isDarkEmailHeader({ primary: '#8a4dea', secondary: '#6b46c1' }), ALL))
      .toBe('wide-dark');
    expect(pickBrandLogoVariant('wide', isDarkEmailHeader({ primary: '#fde68a', secondary: '#fcd34d' }), ALL))
      .toBe('wide');
  });
});

describe('resolveBrandLogoForPreview', () => {
  const URLS = {
    logoUrl: '/api/documents/view/square-file?t=1',
    logoWideUrl: '/api/documents/view/wide-file?t=2',
  };

  const DARK_URLS = {
    ...URLS,
    logoDarkUrl: '/api/documents/view/square-dark-file?t=3',
    logoWideDarkUrl: '/api/documents/view/wide-dark-file?t=4',
  };

  it('points each dark variant at its own branding URL', () => {
    const wideDark = resolveBrandLogoForPreview(
      applyBrandLogo('<body><h1>Hi</h1></body>', { variant: 'wide-dark' }),
      DARK_URLS,
    );
    const dark = resolveBrandLogoForPreview(
      applyBrandLogo('<body><h1>Hi</h1></body>', { variant: 'dark' }),
      DARK_URLS,
    );

    expect(wideDark).toContain(`src="${DARK_URLS.logoWideDarkUrl}"`);
    expect(dark).toContain(`src="${DARK_URLS.logoDarkUrl}"`);
  });

  it('walks the same fallback chain the send path does', () => {
    const wideDark = applyBrandLogo('<body><h1>Hi</h1></body>', { variant: 'wide-dark' });
    const dark = applyBrandLogo('<body><h1>Hi</h1></body>', { variant: 'dark' });

    // wide-dark → wide → default
    expect(resolveBrandLogoForPreview(wideDark, URLS)).toContain(`src="${URLS.logoWideUrl}"`);
    expect(resolveBrandLogoForPreview(wideDark, { logoUrl: URLS.logoUrl })).toContain(`src="${URLS.logoUrl}"`);
    // dark → default
    expect(resolveBrandLogoForPreview(dark, URLS)).toContain(`src="${URLS.logoUrl}"`);
    expect(resolveBrandLogoForPreview(dark, {})).toBe(dark);
  });

  it('points each variant at the branding URL an iframe can resolve', () => {
    const wide = resolveBrandLogoForPreview(applyBrandLogo('<body><h1>Hi</h1></body>', LOGO), URLS);
    const square = resolveBrandLogoForPreview(
      applyBrandLogo('<body><h1>Hi</h1></body>', { variant: 'default' }),
      URLS,
    );

    expect(wide).toContain(`src="${URLS.logoWideUrl}"`);
    expect(square).toContain(`src="${URLS.logoUrl}"`);
    expect(wide).toContain(BRAND_LOGO_MARKER);
  });

  it('falls back to the square logo when no wide one is uploaded', () => {
    const resolved = resolveBrandLogoForPreview(
      applyBrandLogo('<body><h1>Hi</h1></body>', LOGO),
      { logoUrl: URLS.logoUrl },
    );

    expect(resolved).toContain(`src="${URLS.logoUrl}"`);
  });

  it('leaves the tag alone when neither variant is uploaded', () => {
    const branded = applyBrandLogo('<body><h1>Hi</h1></body>', LOGO);

    expect(resolveBrandLogoForPreview(branded, {})).toBe(branded);
  });

  it('leaves a legacy URL tag and other cid images untouched', () => {
    const legacy = '<img data-alga-brand-logo src="/api/documents/view/old-file?t=3" alt=""/>';
    const other = '<img src="cid:some-other-image" alt=""/>';

    expect(resolveBrandLogoForPreview(legacy, URLS)).toBe(legacy);
    expect(resolveBrandLogoForPreview(other, URLS)).toBe(other);
  });

  it('is idempotent', () => {
    const once = resolveBrandLogoForPreview(applyBrandLogo('<body><h1>Hi</h1></body>', LOGO), URLS);

    expect(resolveBrandLogoForPreview(once, URLS)).toBe(once);
  });

  it('resolves a hand-edited tag whose src is single-quoted', () => {
    const singleQuoted = "<img data-alga-brand-logo src='cid:alga-brand-logo-wide' alt=''/>";

    const resolved = resolveBrandLogoForPreview(singleQuoted, URLS);

    expect(resolved).toContain(`src="${URLS.logoWideUrl}"`);
    expect(resolved).not.toContain('cid:');
  });
});

describe('withImgSrc', () => {
  it('replaces the src whichever way the tag quotes it', () => {
    expect(withImgSrc('<img src="cid:old" alt=""/>', 'cid:new')).toBe('<img src="cid:new" alt=""/>');
    expect(withImgSrc("<img src='cid:old' alt=''/>", 'cid:new')).toBe('<img src="cid:new" alt=\'\'/>');
    expect(withImgSrc('<img src=cid:old alt=""/>', 'cid:new')).toBe('<img src="cid:new" alt=""/>');
  });

  it('adds one to a tag that carries none, rather than a second attribute', () => {
    const added = withImgSrc('<img data-alga-brand-logo alt=""/>', 'cid:alga-brand-logo');

    expect(added).toBe('<img src="cid:alga-brand-logo" data-alga-brand-logo alt=""/>');
    expect(added.match(/src=/g)).toHaveLength(1);
  });
});

describe('findBrandLogoCid', () => {
  it('names the content-id the template references', () => {
    expect(findBrandLogoCid(applyBrandLogo('<body><h1>Hi</h1></body>', LOGO))).toBe('alga-brand-logo-wide');
    expect(findBrandLogoCid(applyBrandLogo('<body><h1>Hi</h1></body>', { variant: 'default' })))
      .toBe('alga-brand-logo');
  });

  it('has nothing to name for an unbranded or legacy template', () => {
    expect(findBrandLogoCid('<body><h1>Hi</h1></body>')).toBeNull();
    expect(findBrandLogoCid('<img data-alga-brand-logo src="/api/documents/view/old?t=3"/>')).toBeNull();
  });
});

describe('stripBrandAttribution', () => {
  it('removes the leading attribution and its separator from a layout footer', () => {
    const template = loadSystemTemplate('ticket-created');
    expect(containsBrandAttribution(template.html)).toBe(true);

    const stripped = stripBrandAttribution(template.html);

    expect(containsBrandAttribution(stripped)).toBe(false);
    expect(stripped).toContain('Keeping teams aligned');
    expect(stripped).not.toContain('&middot; Keeping teams aligned');
  });

  it('removes the trailing attribution from the default copyright footer', () => {
    const footer = '<td>&copy; {{currentYear}} {{companyName}} &middot; Powered by AlgaPSA</td>';

    expect(stripBrandAttribution(footer)).toBe('<td>&copy; {{currentYear}} {{companyName}}</td>');
  });

  it('removes the standalone paragraph portal-invitation carries', () => {
    const footer = '<div class="footer"><p>Sent to you</p><p>Powered by AlgaPSA</p></div>';

    expect(stripBrandAttribution(footer)).toBe('<div class="footer"><p>Sent to you</p></div>');
  });

  it('handles the bullet separator older migrations wrote', () => {
    expect(stripBrandAttribution('<td>Powered by AlgaPSA • Keeping teams aligned</td>'))
      .toBe('<td>Keeping teams aligned</td>');
  });
});

describe('decorateBrandedHtml', () => {
  it('does nothing when neither option is set', () => {
    const template = loadSystemTemplate('ticket-created');

    expect(decorateBrandedHtml(template.html, {})).toBe(template.html);
  });

  it('drops a previously written logo when the option is turned off', () => {
    const template = loadSystemTemplate('ticket-created');
    const branded = decorateBrandedHtml(template.html, { logo: LOGO });

    expect(decorateBrandedHtml(branded, {})).toBe(template.html);
  });

  it('applies both passes together', () => {
    const template = loadSystemTemplate('ticket-created');
    const branded = decorateBrandedHtml(template.html, { logo: LOGO, hideAttribution: true });

    expect(countLogos(branded)).toBe(1);
    expect(containsBrandAttribution(branded)).toBe(false);
  });
});
