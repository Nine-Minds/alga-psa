'use client';

import React, { useState, useEffect } from 'react';
import { IConditionalRule, IInvoiceTemplate } from '@alga-psa/types';
import { getConditionalRules, saveConditionalRule } from '@alga-psa/billing/actions/invoiceTemplates';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ConditionalRuleManagerProps {
  template: IInvoiceTemplate;
}

const ConditionalRuleManager: React.FC<ConditionalRuleManagerProps> = ({ template }) => {
  const { t } = useTranslation('msp/billing');
  const [rules, setRules] = useState<IConditionalRule[]>([]);
  const [newRule, setNewRule] = useState<Partial<IConditionalRule>>({});

  const actionOptions = [
    { value: '', label: t('templateDesigner.conditionalRules.selectAction', { defaultValue: 'Select Action' }) },
    { value: 'show', label: t('templateDesigner.conditionalRules.show', { defaultValue: 'Show' }) },
    { value: 'hide', label: t('templateDesigner.conditionalRules.hide', { defaultValue: 'Hide' }) },
    { value: 'format', label: t('templateDesigner.conditionalRules.format', { defaultValue: 'Format' }) }
  ];

  useEffect(() => {
    fetchRules();
  }, [template.template_id]);

  const fetchRules = async () => {
    const fetchedRules = await getConditionalRules(template.template_id);
    setRules(fetchedRules);
  };

  const handleSaveRule = async () => {
    if (newRule.condition && newRule.action && newRule.target) {
      await saveConditionalRule({
        ...newRule,
        template_id: template.template_id,
      } as IConditionalRule);
      fetchRules();
      setNewRule({});
    }
  };

  return (
    <div>
      <h3>{t('templateDesigner.conditionalRules.title', { defaultValue: 'Conditional Display Rules' })}</h3>
      <ul>
        {rules.map((rule): React.JSX.Element => (
          <li key={rule.rule_id}>
            {rule.condition} - {rule.action} - {rule.target}
          </li>
        ))}
      </ul>
      <div>
        <input
          type="text"
          placeholder={t('templateDesigner.conditionalRules.conditionPlaceholder', { defaultValue: 'Condition' })}
          value={newRule.condition || ''}
          onChange={(e) => setNewRule({...newRule, condition: e.target.value})}
        />
        <CustomSelect
          value={newRule.action || ''}
          onValueChange={(value) => setNewRule({...newRule, action: value as IConditionalRule['action']})}
          options={actionOptions}
        />
        <input
          type="text"
          placeholder={t('templateDesigner.conditionalRules.targetPlaceholder', { defaultValue: 'Target' })}
          value={newRule.target || ''}
          onChange={(e) => setNewRule({...newRule, target: e.target.value})}
        />
        <button onClick={handleSaveRule}>
          {t('templateDesigner.conditionalRules.addRule', { defaultValue: 'Add Rule' })}
        </button>
      </div>
    </div>
  );
};

export default ConditionalRuleManager;
