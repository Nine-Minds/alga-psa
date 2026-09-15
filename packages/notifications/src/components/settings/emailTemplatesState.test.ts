import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { collectTemplateLanguages, initialLanguageSelection } from './emailTemplatesState';

const templatesSource = readFileSync(resolve(__dirname, 'EmailTemplates.tsx'), 'utf8');

describe('collectTemplateLanguages', () => {
  it('merges system and tenant languages into a sorted, deduplicated list', () => {
    expect(collectTemplateLanguages({
      systemTemplates: [{ language_code: 'fr' }, { language_code: 'en' }, { language_code: 'en' }],
      tenantTemplates: [{ language_code: 'de' }, { language_code: 'fr' }],
    })).toEqual(['de', 'en', 'fr']);
  });

  it('drops blank language codes', () => {
    expect(collectTemplateLanguages({
      systemTemplates: [{ language_code: '' }, { language_code: 'en' }],
      tenantTemplates: [],
    })).toEqual(['en']);
  });
});

describe('initialLanguageSelection', () => {
  it('preselects the tenant default language', () => {
    expect(initialLanguageSelection(['de', 'en', 'fr'], 'fr')).toEqual(['fr']);
  });

  it('shows everything when the default language has no templates', () => {
    expect(initialLanguageSelection(['en'], 'pl')).toEqual([]);
  });

  it('shows everything when the tenant has no default language', () => {
    expect(initialLanguageSelection(['en'], null)).toEqual([]);
    expect(initialLanguageSelection(['en'], undefined)).toEqual([]);
  });
});

describe('language filter wiring', () => {
  it('prefills from the tenant default without changing how the filter behaves', () => {
    expect(templatesSource).toContain('getTenantLocaleSettingsAction()');
    expect(templatesSource).toContain('localeSettings?.defaultLocale');
    expect(templatesSource).toContain('!languageFilterTouched.current');
    expect(templatesSource).toContain('languageFilterTouched.current = true;');
    // Clearing still means "show all", exactly as before.
    expect(templatesSource).toContain('setSelectedLanguages(new Set());');
  });
});
