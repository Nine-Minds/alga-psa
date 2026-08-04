import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('opportunity UI improvement wiring', () => {
  it('persists the Queue cards/table view and renders both view controls', () => {
    const workQueue = source('../src/components/queue/WorkQueue.tsx');

    expect(workQueue).toContain("useState<'cards' | 'table'>('cards')");
    expect(workQueue).toContain('window.localStorage.getItem(preferenceKey)');
    expect(workQueue).toContain('window.localStorage.setItem(preferenceKey, next)');
    expect(workQueue).toContain('id="opportunities-queue-view-cards"');
    expect(workQueue).toContain('id="opportunities-queue-view-table"');
    expect(workQueue).toContain('<QueueActionsTable');
  });

  it('makes the Queue circle an accessible click-to-complete control', () => {
    const row = source('../src/components/queue/QueueActionRow.tsx');

    expect(row).toContain('id={`${idBase}-complete-control`}');
    expect(row).toContain("type=\"button\"");
    expect(row).toContain("aria-label={t('opportunities.queue.completeActionFor'");
    expect(row).toContain('onClick={() => onComplete(item.opportunity_id, item.stage)}');
  });

  it('offers stage-based guidance while retaining free-form next-action inputs', () => {
    const createDialog = source('../src/components/dialogs/CreateOpportunityDialog.tsx');
    const completeDialog = source('../src/components/dialogs/CompleteActionDialog.tsx');

    expect(createDialog).toContain('<ActionSuggestions');
    expect(createDialog).toContain('stage="identified"');
    expect(createDialog).toContain('id="opportunity-create-next-action"');
    expect(completeDialog).toContain('<ActionSuggestions');
    expect(completeDialog).toContain('stage={stage}');
    expect(completeDialog).toContain('id="opportunity-complete-next-action"');
  });

  it('suggests the tenant\'s own sales process, falling back to the stock list', () => {
    const suggestions = source('../src/components/ActionSuggestions.tsx');
    expect(suggestions).toContain('listOpportunityStepTemplates(stage)');
    expect(suggestions).toContain('SUGGESTED_NEXT_ACTIONS[stage]');
    // An empty tenant list must not blank out the stock suggestions.
    expect(suggestions).toContain('templates.length === 0');
  });

  it('lays the whole sales process out on one settings screen', () => {
    const settings = source('../../../server/src/app/msp/settings/opportunities/OpportunityStepTemplatesSettings.tsx');
    expect(settings).toContain("const STAGES: PlannableStage[] = ['identified', 'qualified', 'assessment', 'proposed', 'verbal']");
    expect(settings).toContain('opportunity-step-templates-${stage}');
    expect(settings).toContain('saveOpportunityStepTemplates(stage, plan[stage])');
  });

  it('opens prospect quick-add from ClientPicker and auto-selects the new client', () => {
    const createDialog = source('../src/components/dialogs/CreateOpportunityDialog.tsx');
    const host = source('../../../server/src/components/opportunities/OpportunitiesHubHost.tsx');

    expect(createDialog).toContain('onAddNew={renderClientCreator ? () => setClientCreatorOpen(true) : undefined}');
    expect(createDialog).toContain('setClientId(client.client_id)');
    expect(host).toContain('initialLifecycleStatus="prospect"');
    expect(host).toContain('skipSuccessDialog');
    expect(host).not.toContain('opportunity-add-prospect');
  });

  it('preserves deep links, detail navigation, and clickable client names', () => {
    const hub = source('../src/components/OpportunitiesHub.tsx');
    const detailHost = source('../src/components/detail/OpportunityDetailHost.tsx');
    const detailView = source('../src/components/detail/OpportunityDetailView.tsx');
    const detailPage = source('../../../server/src/app/msp/opportunities/[opportunityId]/page.tsx');

    expect(hub).toContain('useSearchParams()');
    expect(hub).toContain('router.replace(`/msp/opportunities?${params.toString()}`');
    expect(hub).toContain('initialStage={initialPipelineStage}');
    expect(detailHost).toContain('id="opportunity-back-to-list"');
    expect(detailView).toContain('href={`/msp/clients/${detail.client_id}`}');
    expect(detailPage).toContain('const detail = await getOpportunity((await params).opportunityId)');
  });
});
