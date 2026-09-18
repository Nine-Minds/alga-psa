import { describe, expect, it } from 'vitest';
import {
  applyBrandLogo,
  containsBrandAttribution,
  decorateBrandedHtml,
  resolveBrandLogoForPreview,
  stripBrandAttribution,
  BRAND_LOGO_MARKER,
} from '../brandAssets';
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

describe('resolveBrandLogoForPreview', () => {
  const URLS = {
    logoUrl: '/api/documents/view/square-file?t=1',
    logoWideUrl: '/api/documents/view/wide-file?t=2',
  };

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
