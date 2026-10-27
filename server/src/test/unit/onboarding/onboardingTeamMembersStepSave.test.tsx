/**
 * @vitest-environment jsdom
 */
import React, { useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WizardData } from '@alga-psa/types';

import { TeamMembersStep } from '../../../../../packages/onboarding/src/components/steps/TeamMembersStep';

/**
 * The team step's per-row Save: a member the server created but could not
 * record in saved progress is shown as created AND warned about, never as a
 * silent success, and the warning is the translated string, not server English.
 */
const mocks = vi.hoisted(() => ({
  addSingleTeamMember: vi.fn(),
}));

vi.mock('@alga-psa/onboarding/actions/onboarding-actions/onboardingActions', () => ({
  getOnboardingLicenseUsage: vi.fn(async () => ({ success: true, data: { limit: null, used: 1 } })),
  getAvailableRoles: vi.fn(async () => ({ success: true, data: [{ value: 'Technician', label: 'Technician', roleId: 'role-tech' }] })),
  addSingleTeamMember: mocks.addSingleTeamMember,
}));
vi.mock('@alga-psa/users/actions/user-actions/userInvitationActions', () => ({ sendUserInvitation: vi.fn() }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    // Marks translated output so the test can tell it from server English.
    t: (key: string, options?: Record<string, unknown>) =>
      `[${key}] ${String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? ''))}`,
  }),
}));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: ({ children }: any) => <label>{children}</label> }));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, onClick, disabled }: any) => <button id={id} onClick={onClick} disabled={disabled}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, variant }: any) => <div role="alert" data-variant={variant}>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => <div /> }));
vi.mock('@alga-psa/ui/components/ViewSwitcher', () => ({ default: () => <div /> }));

afterEach(cleanup);
beforeEach(() => mocks.addSingleTeamMember.mockReset());

const filledMember = {
  firstName: 'Tom', lastName: 'Tech', email: 'tom@example.test', role: 'Technician',
  inviteMode: 'password' as const, password: 'Temp-Pass-123!',
};

function Harness() {
  const [data, setData] = useState<WizardData>({ teamMembers: [filledMember] } as unknown as WizardData);
  return (
    <>
      <TeamMembersStep data={data} updateData={(patch) => setData(prev => ({ ...prev, ...patch }))} />
      <span data-testid="created">{(data.createdTeamMemberEmails ?? []).join(',')}</span>
    </>
  );
}

async function saveRow() {
  const user = userEvent.setup();
  render(<Harness />);
  const save = await waitFor(() => {
    const button = document.getElementById('save-member-0');
    if (!button) throw new Error('save button not rendered yet');
    return button;
  });
  await user.click(save);
}

describe('TeamMembersStep per-row save', () => {
  it('marks the member created and warns, in the translated string, when progress was not saved', async () => {
    mocks.addSingleTeamMember.mockResolvedValue({ success: true, data: {
      created: 'tom@example.test', progressError: 'The team members were created, but setup progress could not be saved.',
    } });
    await saveRow();

    await waitFor(() => expect(screen.getByTestId('created')).toHaveTextContent('tom@example.test'));
    const warning = screen.getAllByRole('alert').find(el => el.getAttribute('data-variant') === 'warning');
    expect(warning).toBeDefined();
    expect(warning).toHaveTextContent('[teamMembersStep.errors.progressNotSaved]');
    expect(warning).toHaveTextContent('tom@example.test was created, but setup could not save its progress');
    expect(warning).not.toHaveTextContent('The team members were created, but setup progress could not be saved.');
  });

  it('shows no warning when progress was saved', async () => {
    mocks.addSingleTeamMember.mockResolvedValue({ success: true, data: { created: 'tom@example.test' } });
    await saveRow();

    await waitFor(() => expect(screen.getByTestId('created')).toHaveTextContent('tom@example.test'));
    expect(screen.queryAllByRole('alert').some(el => el.getAttribute('data-variant') === 'warning')).toBe(false);
  });
});
