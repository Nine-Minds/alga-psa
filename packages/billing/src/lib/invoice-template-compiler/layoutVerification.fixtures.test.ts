import { describe, expect, it } from 'vitest';
import {
  FAILING_LAYOUT_FIXTURE,
  PASSING_LAYOUT_FIXTURE,
} from './__fixtures__/layoutVerificationFixtures';
import {
  collectRenderedGeometryFromLayout,
  compareLayoutConstraints,
  extractExpectedLayoutConstraintsFromIr,
} from './layoutVerification';

describe('layoutVerification fixture coverage', () => {
  it('passes aligned design fixture within tolerance', () => {
    const constraints = extractExpectedLayoutConstraintsFromIr(
      PASSING_LAYOUT_FIXTURE.ir,
      PASSING_LAYOUT_FIXTURE.tolerance
    );
    const renderedGeometry = collectRenderedGeometryFromLayout(PASSING_LAYOUT_FIXTURE.renderedLayout);
    const result = compareLayoutConstraints(constraints, renderedGeometry);

    expect(result.status).toBe('pass');
    expect(result.mismatches).toHaveLength(0);
  });

  it('fails drifted design fixture with expected mismatch set', () => {
    const constraints = extractExpectedLayoutConstraintsFromIr(
      FAILING_LAYOUT_FIXTURE.ir,
      FAILING_LAYOUT_FIXTURE.tolerance
    );
    const renderedGeometry = collectRenderedGeometryFromLayout(FAILING_LAYOUT_FIXTURE.renderedLayout);
    const result = compareLayoutConstraints(constraints, renderedGeometry);

    expect(result.status).toBe('issues');
    expect(result.mismatches.map((mismatch) => mismatch.constraintId).sort()).toEqual(
      [...FAILING_LAYOUT_FIXTURE.expectedMismatchConstraintIds].sort()
    );

    result.mismatches.forEach((mismatch) => {
      expect(mismatch.expected).toBeTypeOf('number');
      expect(mismatch.actual).toBeTypeOf('number');
      expect(mismatch.delta).toBeTypeOf('number');
      expect(mismatch.tolerance).toBe(FAILING_LAYOUT_FIXTURE.tolerance);
    });
  });
});
