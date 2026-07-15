import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const milestoneTemplate = require('../../../../migrations/utils/templates/email/projects/projectMilestoneReady.cjs');
const budgetTemplate = require('../../../../migrations/utils/templates/email/projects/projectBudgetThresholdReached.cjs');
const emailSubscriberSource = readFileSync(
  new URL('../../../lib/eventBus/subscribers/projectEmailSubscriber.ts', import.meta.url),
  'utf8',
);
const inAppSubscriberSource = readFileSync(
  new URL('../../../lib/eventBus/subscribers/internalNotificationSubscriber.ts', import.meta.url),
  'utf8',
);

describe('project billing notification contracts (T026)', () => {
  it('resolves localized email templates with all required project billing variables', () => {
    const milestone = milestoneTemplate.getTemplate();
    const budget = budgetTemplate.getTemplate();

    expect(milestone.templateName).toBe('project-milestone-ready');
    expect(budget.templateName).toBe('project-budget-threshold-reached');
    expect(milestone.translations).toHaveLength(8);
    expect(budget.translations).toHaveLength(8);

    for (const translation of milestone.translations) {
      const renderedSource = `${translation.subject}\n${translation.htmlContent}\n${translation.textContent}`;
      expect(renderedSource).toContain('{{entry.description}}');
      expect(renderedSource).toContain('{{entry.amount}}');
      expect(renderedSource).toContain('{{entry.trigger}}');
      expect(renderedSource).toContain('{{project.url}}');
    }
    for (const translation of budget.translations) {
      const renderedSource = `${translation.subject}\n${translation.htmlContent}\n${translation.textContent}`;
      expect(renderedSource).toContain('{{project.name}}');
      expect(renderedSource).toContain('{{budget.threshold}}');
      expect(renderedSource).toContain('{{budget.billed}}');
      expect(renderedSource).toContain('{{budget.cap}}');
    }
  });

  it('routes milestone-ready and threshold events through email and in-app templates', () => {
    for (const source of [emailSubscriberSource, inAppSubscriberSource]) {
      expect(source).toContain("case 'PROJECT_MILESTONE_READY'");
      expect(source).toContain("case 'PROJECT_BUDGET_THRESHOLD_REACHED'");
      expect(source).toContain("'project-milestone-ready'");
      expect(source).toContain("'project-budget-threshold-reached'");
    }
  });
});
