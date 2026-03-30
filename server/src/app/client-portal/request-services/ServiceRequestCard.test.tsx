/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';

import { ServiceRequestCard } from './ServiceRequestCard';

describe('ServiceRequestCard', () => {
  it('renders service metadata without leaking the raw icon slug into the card body', () => {
    render(
      <ServiceRequestCard
        title="New Hire"
        description="Collect onboarding details"
        icon="user-plus"
        categoryLabel="Onboarding"
      />
    );

    expect(screen.getByText('New Hire')).toBeInTheDocument();
    expect(screen.getByText('Collect onboarding details')).toBeInTheDocument();
    expect(screen.getByText('Onboarding')).toBeInTheDocument();
    expect(screen.queryByText('user-plus')).not.toBeInTheDocument();
  });
});
