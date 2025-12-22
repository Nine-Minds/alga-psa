'use client';

import React, { useState, useEffect } from 'react';
import { IConditionalRule, IInvoiceTemplate } from 'server/src/interfaces/invoice.interfaces';
import { getConditionalRules, saveConditionalRule } from 'server/src/lib/actions/invoiceTemplates';
import CustomSelect from 'server/src/components/ui/CustomSelect';

interface ConditionalRuleManagerProps {
  template: IInvoiceTemplate;
}

const ConditionalRuleManager: React.FC<ConditionalRuleManagerProps> = ({ template }) => {
  const [rules, setRules] = useState<IConditionalRule[]>([]);
  const [newRule, setNewRule] = useState<Partial<IConditionalRule>>({});

  const actionOptions = [
    { value: '', label: 'Select Action' },
    { value: 'show', label: 'Show' },
    { value: 'hide', label: 'Hide' },
    { value: 'format', label: 'Format' }
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
      <h3>Conditional Display Rules</h3>
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
          placeholder="Condition"
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
          placeholder="Target"
          value={newRule.target || ''}
          onChange={(e) => setNewRule({...newRule, target: e.target.value})}
        />
        <button onClick={handleSaveRule}>Add Rule</button>
      </div>
    </div>
  );
};

export default ConditionalRuleManager;
