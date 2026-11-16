import { describe, expect, it } from 'vitest';
import { getServiceRequestEnterpriseProviderRegistrations } from '../../../../../ee/server/src/lib/service-requests/providers';
import { computeVisibleFieldKeys, parseVisibilityRules } from '../../../lib/service-requests/formVisibility';
import { ADVANCED_FORM_BEHAVIOR_EXAMPLES } from './advancedFormBehaviorExamples';

const context = { requesterUserId: 'user-1', clientId: 'client-1', contactId: 'contact-1' };
const byId = (id: string) => ADVANCED_FORM_BEHAVIOR_EXAMPLES.find((example) => example.id === id)!.config;

/** The editor's own save-time parsing: the textarea text is JSON.parse'd and must be an object. */
function parseLikeEditor(text: string): Record<string, unknown> {
  const parsed = text.trim() ? JSON.parse(text) : {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
  return parsed;
}

describe('advanced form behavior help examples', () => {
  it.each(ADVANCED_FORM_BEHAVIOR_EXAMPLES.map((example) => [example.id, example] as const))(
    '%s survives the editor parse and the advanced provider publish validation',
    async (_id, example) => {
      const config = parseLikeEditor(JSON.stringify(example.config, null, 2));
      const { formBehaviorProviders } = await getServiceRequestEnterpriseProviderRegistrations();
      const advanced = formBehaviorProviders.find((provider) => provider.key === 'advanced')!;
      expect(advanced.validateConfig(config)).toEqual({ isValid: true, errors: undefined });
      // Every rule is retained by the parser (none silently dropped as malformed).
      const rules = parseVisibilityRules(config) ?? [];
      expect(rules).toHaveLength((config.visibilityRules as unknown[] | undefined)?.length ?? 0);
    }
  );

  it('showWhen: "Tell us more" appears only when Reason equals Other', () => {
    const fields = [{ key: 'reason' }, { key: 'tell_us_more' }];
    const rules = parseVisibilityRules(byId('showWhen'))!;
    expect(computeVisibleFieldKeys(fields, rules, { reason: 'Other' }, context)).toEqual(['reason', 'tell_us_more']);
    expect(computeVisibleFieldKeys(fields, rules, { reason: 'Billing' }, context)).toEqual(['reason']);
  });

  it('hideWhen: Company is hidden when "I am the end user" is checked', () => {
    const fields = [{ key: 'i_am_end_user' }, { key: 'company' }];
    const rules = parseVisibilityRules(byId('hideWhen'))!;
    expect(computeVisibleFieldKeys(fields, rules, { i_am_end_user: true }, context)).toEqual(['i_am_end_user']);
    expect(computeVisibleFieldKeys(fields, rules, { i_am_end_user: false }, context)).toEqual(['i_am_end_user', 'company']);
  });

  it('prefill: Client is hidden and prefilled with the requesting client', async () => {
    const config = byId('prefill');
    const fields = [{ key: 'client' }, { key: 'other' }];
    expect(computeVisibleFieldKeys(fields, parseVisibilityRules(config)!, {}, context)).toEqual(['other']);
    const { formBehaviorProviders } = await getServiceRequestEnterpriseProviderRegistrations();
    const advanced = formBehaviorProviders.find((provider) => provider.key === 'advanced')!;
    await expect(advanced.resolveInitialValues!({ tenant: 't', ...context }, config)).resolves.toEqual({ client: 'client-1' });
  });
});
