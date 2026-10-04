import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  decorateBrandedHtml,
  isDarkEmailHeader,
  pickBrandLogoVariant,
  resolveBrandLogoForPreview,
  resolveEmailPalette,
  STOCK_EMAIL_PALETTE,
} from '@alga-psa/email/branding';
import {
  OVERRIDABLE_TOKENS,
  TOKEN_IDS,
  draftFromStatus,
  draftMatchesSuggestion,
  resolveDraft,
  shouldShowNewTemplateBanner,
} from './emailBrandingPanelState';
import type { EmailBrandingStatus } from '../../lib/emailBranding';

const panelSource = readFileSync(resolve(__dirname, 'EmailBrandingPanel.tsx'), 'utf8');
const templatesSource = readFileSync(resolve(__dirname, 'EmailTemplates.tsx'), 'utf8');
const tabHostSource = readFileSync(resolve(__dirname, 'EmailBrandingTab.tsx'), 'utf8');
const previewSource = readFileSync(resolve(__dirname, 'EmailTemplatePreview.tsx'), 'utf8');
const actionsSource = readFileSync(
  resolve(__dirname, '../../actions/notification-actions/emailBrandingActions.ts'),
  'utf8',
);

const LOGO_OPTIONS = {
  logoUrl: '/api/documents/view/square-file?t=1',
  logoWideUrl: '/api/documents/view/wide-file?t=2',
};

const repoRoot = resolve(__dirname, '../../../../..');
const settingsHostSource = readFileSync(
  resolve(repoRoot, 'server/src/components/settings/general/NotificationsTab.tsx'),
  'utf8',
);
const pageHostSource = readFileSync(
  resolve(repoRoot, 'server/src/app/msp/settings/notifications/page.tsx'),
  'utf8',
);

const status = (overrides: Partial<EmailBrandingStatus> = {}): EmailBrandingStatus => ({
  palette: null,
  resolved: STOCK_EMAIL_PALETTE,
  suggestion: { primary: '#1d4ed8', secondary: '#0f766e', source: 'theme-pair' },
  languages: ['en'],
  availableLanguages: ['en'],
  templates: [],
  newTemplateNames: [],
  canEdit: true,
  isEnterprise: false,
  logoOptions: {},
  ...overrides,
});

describe('email branding draft', () => {
  it('prefills from the suggestion when nothing is saved', () => {
    const draft = draftFromStatus(status());

    expect(draft.primary).toBe('#1d4ed8');
    expect(draft.secondary).toBe('#0f766e');
    expect(draft.singleColor).toBe(false);
    expect(draftMatchesSuggestion(draft, status())).toBe(true);
  });

  it('prefers the saved palette and reports that it differs from the suggestion', () => {
    const saved = status({ palette: { primary: '#b4552f', secondary: '#3f4d8a' } });
    const draft = draftFromStatus(saved);

    expect(draft.primary).toBe('#b4552f');
    expect(draftMatchesSuggestion(draft, saved)).toBe(false);
  });

  it('reads single-color mode back from a saved palette', () => {
    const draft = draftFromStatus(status({ palette: { primary: '#b4552f', secondary: null } }));

    expect(draft.singleColor).toBe(true);
    expect(resolveDraft(draft).secondary).not.toBe(draft.secondary);
  });

  it('resolves overrides on top of the derived tokens', () => {
    const draft = draftFromStatus(status({
      palette: { primary: '#b4552f', secondary: '#3f4d8a', overrides: { cardBorder: '#123456' } },
    }));

    expect(resolveDraft(draft).cardBorder).toBe('#123456');
    expect(resolveDraft(draft).outerBg).not.toBe('#123456');
  });

  it('carries the Enterprise fields into the draft', () => {
    const draft = draftFromStatus(status({
      palette: { primary: '#b4552f', secondary: null, logo: { variant: 'wide' }, hideAttribution: true },
    }));

    expect(draft.logoVariant).toBe('wide');
    expect(draft.hideAttribution).toBe(true);
  });
});

describe('email branding panel markup', () => {
  it('renders as a card on its own tab, out of the templates tab', () => {
    expect(panelSource).toContain('id="email-branding-card"');
    expect(tabHostSource).toContain('<EmailBrandingPanel');
    expect(templatesSource).not.toContain('EmailBrandingPanel');
  });

  it('is hidden for AlgaDesk in both settings hosts, with no feature flag', () => {
    for (const host of [settingsHostSource, pageHostSource]) {
      expect(host).toContain("id: 'email-branding'");
      expect(host).toContain("isAlgaDesk ? [] : ['email-branding']");
      expect(host).not.toContain('useFeatureFlag');
    }
  });

  it('picks colors with the shared color picker, not native inputs', () => {
    expect(panelSource).toContain("@alga-psa/ui/components/ColorPicker");
    expect(panelSource).toContain('showTextColor={false}');
    expect(panelSource).not.toContain('type="color"');
  });

  it('shows a source chip and the "use suggested colors" affordance', () => {
    expect(panelSource).toContain('id="email-branding-source-chip"');
    expect(panelSource).toContain('id="use-suggested-email-colors"');
    expect(panelSource).toContain('!draftMatchesSuggestion(draft, status)');
  });

  it('hides the secondary color behind the single-color toggle', () => {
    expect(panelSource).toContain('id="email-branding-single-color"');
    expect(panelSource).toMatch(/!draft\.singleColor && \(\s*<ColorField\s*\n\s*id="email-branding-secondary-color"/);
  });

  it('offers every derived token as an overridable field behind Adjust', () => {
    expect(panelSource).toContain('id="email-branding-adjust-tokens"');
    for (const token of OVERRIDABLE_TOKENS) {
      expect(TOKEN_IDS[token]).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    expect(panelSource).toContain('id={`email-branding-override-${TOKEN_IDS[token]}`}');
  });

  it('renders the preview client-side from the system HTML with no server call', () => {
    expect(panelSource).toContain('applyEmailPalette(html, STOCK_EMAIL_PALETTE, resolved)');
    expect(panelSource).toContain('htmlContent={previewHtml(previewTemplate.html_content)}');
    const previewBlock = panelSource.slice(panelSource.indexOf('{previewTemplate && ('));
    expect(previewBlock.slice(0, previewBlock.indexOf('</div>'))).not.toContain('Action(');
  });

  it('shows exactly one template preview, since the apply dialog previews each one', () => {
    expect(panelSource).toContain('const previewTemplate = useMemo');
    expect(panelSource).toContain('return preferred ?? pool[0] ?? null;');
    expect(panelSource).not.toContain('previewTemplates');
    expect(panelSource.match(/<EmailTemplatePreview/g)).toHaveLength(1);
  });

  it('registers with the unsaved-changes provider while dirty', () => {
    expect(panelSource).toContain("useRegisterUnsavedChanges('email-branding-panel', isDirty)");
  });

  it('gives every control a kebab-case id', () => {
    const literalIds = [...panelSource.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(literalIds.length).toBeGreaterThan(5);

    for (const id of literalIds) {
      expect(id, `${id} is not kebab-case`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

describe('new-template banner', () => {
  const applied = (newTemplateNames: string[]) => status({
    palette: { primary: '#b4552f', secondary: null, appliedAt: '2026-09-01T00:00:00.000Z' },
    newTemplateNames,
  });

  it('appears once templates arrived after the last apply', () => {
    expect(shouldShowNewTemplateBanner(applied(['a', 'b', 'c']), null)).toBe(true);
    expect(shouldShowNewTemplateBanner(applied([]), null)).toBe(false);
  });

  it('stays away until a palette has actually been applied', () => {
    expect(shouldShowNewTemplateBanner(status({ newTemplateNames: ['a'] }), null)).toBe(false);
  });

  it('is dismissed for the session and returns when the count changes', () => {
    expect(shouldShowNewTemplateBanner(applied(['a', 'b', 'c']), 3)).toBe(false);
    expect(shouldShowNewTemplateBanner(applied(['a', 'b', 'c', 'd']), 3)).toBe(true);
  });

  it('opens the scope dialog with exactly the new templates preselected', () => {
    expect(panelSource).toContain('id="new-email-templates-banner"');
    expect(panelSource).toContain('id="apply-branding-to-new-templates"');
    expect(panelSource).toContain('setApplyPreselection(status.newTemplateNames)');
    expect(panelSource).toContain('preselectedNames={applyPreselection}');
    expect(panelSource).toContain('id="dismiss-new-email-templates"');
    expect(panelSource).toContain('window.sessionStorage?.setItem(NEW_TEMPLATE_DISMISS_KEY');
  });
});

describe('enterprise logo and attribution', () => {
  it('renders the section only on Enterprise, checked on both the client and the server', () => {
    expect(panelSource).toContain("process.env.NEXT_PUBLIC_EDITION === 'enterprise'");
    expect(panelSource).toContain('{isEnterpriseEdition && status.isEnterprise && (');
    expect(panelSource).toContain('id="email-branding-enterprise-section"');
  });

  it('offers a logo switch, the uploaded variants and the attribution switch', () => {
    expect(panelSource).toContain('id="email-branding-use-logo"');
    expect(panelSource).toContain('id="email-branding-logo-variant-wide"');
    expect(panelSource).toContain('id="email-branding-logo-variant-default"');
    // A shape whose only upload is the dark artwork is still on offer.
    expect(panelSource).toContain('{hasWideLogo && (');
    expect(panelSource).toContain('{hasSquareLogo && (');
    expect(panelSource).toContain('status.logoOptions.logoWideDarkUrl');
    expect(panelSource).toContain('status.logoOptions.logoDarkUrl');
    expect(panelSource).toContain('id="email-branding-show-attribution"');
    expect(panelSource).toContain('checked={!draft.hideAttribution}');
  });

  it('points at client portal branding when no logo is uploaded', () => {
    expect(panelSource).toContain('const hasAnyLogo =');
    expect(panelSource).toContain("notifications.emailBranding.enterprise.noLogo");
  });

  it('previews the brand assets exactly as an apply would write them', () => {
    expect(panelSource).toContain('decorateBrandedHtml(recolored, {');
    expect(panelSource).toContain('hideAttribution: draft.hideAttribution,');
    // The same chooser the apply decorator runs, over the same resolved palette,
    // so the preview can never show a variant the apply would not write.
    expect(panelSource).toContain(
      'pickBrandLogoVariant(draft.logoVariant, isDarkEmailHeader(resolved), status.logoOptions)',
    );
    expect(actionsSource).toContain('pickBrandLogoVariant(palette.logo.variant, isDarkEmailHeader(target), {');
  });

  it('decorates a dark header with the dark artwork of the chosen shape', () => {
    const darkHeader = { primary: '#3b1c6b', secondary: '#1f1147' };
    const lightHeader = { primary: '#fde68a', secondary: '#fcd34d' };
    const uploads = { ...LOGO_OPTIONS, logoWideDarkUrl: '/api/documents/view/wide-dark-file?t=4' };

    const variantFor = (palette: { primary: string; secondary: string }) =>
      pickBrandLogoVariant('wide', isDarkEmailHeader(resolveEmailPalette(palette)), uploads);

    expect(variantFor(darkHeader)).toBe('wide-dark');
    expect(variantFor(lightHeader)).toBe('wide');

    const decorated = decorateBrandedHtml('<body><h1>Hi</h1></body>', {
      logo: { variant: variantFor(darkHeader)!, alt: 'Acme MSP' },
    });

    expect(decorated).toContain('src="cid:alga-brand-logo-wide-dark"');
    expect(resolveBrandLogoForPreview(decorated, uploads)).toContain(`src="${uploads.logoWideDarkUrl}"`);
  });

  it('writes the logo as a content-id and resolves it to a URL only for the preview', () => {
    const decorated = decorateBrandedHtml('<body><h1>Hi</h1></body>', {
      logo: { variant: 'wide', alt: 'Acme MSP' },
    });

    // What an apply persists: no origin, no URL — the send attaches the bytes.
    expect(decorated).toContain('src="cid:alga-brand-logo-wide"');
    expect(decorated).not.toContain('/api/documents/view/');

    // What the iframe renders instead.
    expect(resolveBrandLogoForPreview(decorated, LOGO_OPTIONS)).toContain(
      `src="${LOGO_OPTIONS.logoWideUrl}"`,
    );

    // The panel and the template list hand the URLs to the preview frame, which
    // substitutes them after the source annotation.
    expect(panelSource).toContain('brandLogoUrls={status.logoOptions}');
    expect(templatesSource).toContain('brandLogoUrls={brandingStatus?.logoOptions}');
    expect(previewSource).toContain(
      'resolveBrandLogoForPreview(annotated, { logoUrl, logoDarkUrl, logoWideUrl, logoWideDarkUrl })',
    );
    // The URLs, not the object a parent may rebuild on every render.
    expect(previewSource).toContain(
      '[htmlContent, sampleData, sourceMap, logoUrl, logoDarkUrl, logoWideUrl, logoWideDarkUrl]',
    );
  });

  it('tells the editor the cid reference is embedded at send time', () => {
    expect(templatesSource).toContain('notifications.emailTemplates.editor.inlineLogoHint');
    expect(templatesSource).toContain('formData.html_content?.includes(BRAND_LOGO_MARKER)');
    // A wide-variant row travels under its own content-id, so the hint reads
    // the one this template carries instead of naming the square one.
    expect(templatesSource).toContain('cid: findBrandLogoCid(formData.html_content) ?? BRAND_LOGO_CIDS.default');
    expect(templatesSource).toContain('src="cid:{{cid}}"');
  });
});
