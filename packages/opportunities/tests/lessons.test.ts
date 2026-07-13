import { describe, expect, it } from 'vitest';
import {
  computeAssessmentConversionLesson,
  computeQuoteVelocityLesson,
} from '../src/lib/lessons';

describe('opportunity lesson computations', () => {
  it('returns null while tenant history is below the lesson thresholds', () => {
    expect(computeAssessmentConversionLesson([
      { status: 'won', created_at: '2026-01-01T00:00:00.000Z' },
      { status: 'lost', created_at: '2026-02-01T00:00:00.000Z' },
      { status: 'won', created_at: '2026-03-01T00:00:00.000Z' },
      { status: 'won', created_at: '2026-04-01T00:00:00.000Z' },
    ], new Date('2026-07-12T00:00:00.000Z'))).toBeNull();

    expect(computeQuoteVelocityLesson(Array.from({ length: 9 }, (_, index) => ({
      status: index % 2 === 0 ? 'won' as const : 'lost' as const,
      created_at: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      first_quote_sent_at: `2026-01-${String(index + 2).padStart(2, '0')}T00:00:00.000Z`,
    })))).toBeNull();
  });

  it('computes assessment win facts and a defined early-quote close-rate ratio', () => {
    expect(computeAssessmentConversionLesson([
      { status: 'won', created_at: '2026-01-01T00:00:00.000Z' },
      { status: 'won', created_at: '2026-02-01T00:00:00.000Z' },
      { status: 'won', created_at: '2026-03-01T00:00:00.000Z' },
      { status: 'won', created_at: '2026-04-01T00:00:00.000Z' },
      { status: 'lost', created_at: '2026-05-01T00:00:00.000Z' },
      { status: 'open', created_at: '2026-06-01T00:00:00.000Z' },
    ], new Date('2026-07-12T00:00:00.000Z'))).toEqual({
      kind: 'lesson_assessment_conversion',
      wonPerFive: 4,
      monthsSinceLastProposed: 1,
    });

    const rows = [
      ...Array.from({ length: 5 }, (_, index) => ({
        status: index < 4 ? 'won' as const : 'lost' as const,
        created_at: '2026-01-01T00:00:00.000Z',
        first_quote_sent_at: '2026-01-05T00:00:00.000Z',
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        status: index < 2 ? 'won' as const : 'lost' as const,
        created_at: '2026-01-01T00:00:00.000Z',
        first_quote_sent_at: '2026-01-10T00:00:00.000Z',
      })),
    ];
    expect(computeQuoteVelocityLesson(rows)).toEqual({
      kind: 'lesson_quote_velocity',
      weekCloseRatio: 2,
    });
  });

  it('returns null when quote-velocity comparison has no usable later close rate', () => {
    const rows = [
      ...Array.from({ length: 5 }, () => ({
        status: 'won' as const,
        created_at: '2026-01-01T00:00:00.000Z',
        first_quote_sent_at: '2026-01-02T00:00:00.000Z',
      })),
      ...Array.from({ length: 5 }, () => ({
        status: 'lost' as const,
        created_at: '2026-01-01T00:00:00.000Z',
        first_quote_sent_at: '2026-01-20T00:00:00.000Z',
      })),
    ];
    expect(computeQuoteVelocityLesson(rows)).toBeNull();
  });
});
