import { describe, expect, it } from 'vitest';
import { getServiceRequestEnterpriseProviderRegistrations } from '../../../../../ee/server/src/lib/service-requests/providers';
import { computeVisibleFieldKeys, parseVisibilityRules } from '../../../lib/service-requests/formVisibility';
import { resolveSubmissionVisibility } from '../../../lib/service-requests/submissionService';
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

  describe('clientScoped', () => {
    const ZERO_ID = '00000000-0000-0000-0000-000000000000';
    const formSchema = { fields: [{ key: 'site_code' }, { key: 'client_reference' }] };

    // Mirrors submissionService: visibility is recomputed, then hidden answers are filtered out.
    async function submit(config: Record<string, unknown>, ctx: typeof context, payload: Record<string, unknown>) {
      const { formBehaviorProviders } = await getServiceRequestEnterpriseProviderRegistrations();
      const advanced = formBehaviorProviders.find((provider) => provider.key === 'advanced')!;
      const initialValues = await advanced.resolveInitialValues!({ tenant: 't', ...ctx }, config);
      const visible = resolveSubmissionVisibility(
        { formSchema, formBehaviorProvider: 'advanced', formBehaviorConfig: config, initialValues, visibleFieldKeys: [] } as any,
        payload,
        ctx
      );
      const kept = Object.fromEntries(Object.entries({ ...initialValues, ...payload }).filter(([key]) => visible.includes(key)));
      return { initialValues, visible, kept };
    }

    it('the prefilled visible field keeps its value through submission', async () => {
      const config = byId('clientScoped');
      const other = await submit(config, context, {});
      expect(other.initialValues).toEqual({ client_reference: 'client-1' });
      expect(other.visible).toEqual(['client_reference']);
      expect(other.kept).toEqual({ client_reference: 'client-1' });

      const scoped = await submit(config, { ...context, clientId: ZERO_ID }, { site_code: 'HQ' });
      expect(scoped.visible).toEqual(['site_code', 'client_reference']);
      expect(scoped.kept).toEqual({ site_code: 'HQ', client_reference: ZERO_ID });
    });

    it('a field hidden by a rule is excluded and its prefilled value is dropped', async () => {
      const config = {
        visibilityRules: [{ fieldKey: 'client_reference', source: 'context.clientId', operator: 'is-empty' }],
        contextDefaults: { client_reference: '{{clientId}}' },
      };
      const result = await submit(config, context, { client_reference: 'client-1' });
      expect(result.initialValues).toEqual({ client_reference: 'client-1' });
      expect(result.visible).not.toContain('client_reference');
      expect(result.kept).toEqual({});
    });
  });
});
