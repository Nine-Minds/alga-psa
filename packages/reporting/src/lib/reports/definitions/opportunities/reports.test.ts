import { describe, expect, it } from 'vitest';
import { ReportRegistry } from '../../core/ReportRegistry';

describe('opportunity report definitions', () => {
  it('registers the four opportunity reports with executable metric definitions', () => {
    const ids = [
      'opportunities.pipeline_by_stage',
      'opportunities.win_loss',
      'opportunities.assessment_conversion',
      'opportunities.generator_yield',
    ];

    for (const id of ids) {
      const report = ReportRegistry.get(id);
      expect(report).not.toBeNull();
      expect(report?.permissions.resources).toContain('opportunities.read');
      expect(report?.metrics.length).toBeGreaterThan(0);
      for (const metric of report?.metrics ?? []) {
        expect(metric.query.table.length).toBeGreaterThan(0);
      }
    }
  });

  it('exposes pipeline dimensions and the generator funnel through the runtime registry', () => {
    const pipeline = ReportRegistry.get('opportunities.pipeline_by_stage');
    expect(pipeline?.metrics[0].query.groupBy).toEqual(expect.arrayContaining([
      'opportunities.stage',
      'opportunities.owner_id',
      'opportunities.opportunity_type',
    ]));

    const yieldReport = ReportRegistry.get('opportunities.generator_yield');
    expect(yieldReport?.metrics[0]).toMatchObject({
      id: 'generator_yield',
      query: { table: 'raw_sql' },
    });
  });
});
