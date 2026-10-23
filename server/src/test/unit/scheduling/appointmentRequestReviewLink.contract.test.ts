import { describe, expect, it } from 'vitest';
import { buildAppointmentRequestReviewUrl } from '@alga-psa/core';
import { templateVariableSeed } from '../../../../../packages/notifications/src/lib/templateVariables/seed';

describe('new-appointment-request approvalLink seed', () => {
  it('documents the same link the helper builds', () => {
    const template = templateVariableSeed
      .flatMap((category) => category.templates)
      .find((t) => t.templateName === 'new-appointment-request');
    const variable = template?.variables.find((v) => v.path === 'approvalLink');

    expect(variable).toBeDefined();
    expect(variable!.example).toBe(
      buildAppointmentRequestReviewUrl('3f2b8c1e-6a4d-4e7b-9c1a-2d5e8f0a7b64', 'https://app.algapsa.com'),
    );
  });
});
