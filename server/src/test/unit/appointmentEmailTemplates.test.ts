import { describe, expect, it } from 'vitest';
import Handlebars from 'handlebars';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  getTemplate: getAppointmentRequestApprovedTemplate,
} = require('../../../../server/migrations/utils/templates/email/appointments/appointmentRequestApproved.cjs');
const {
  getTemplate: getAppointmentAssignedTechnicianTemplate,
} = require('../../../../server/migrations/utils/templates/email/appointments/appointmentAssignedTechnician.cjs');

function renderEnglishHtml(
  templateDef: ReturnType<typeof getAppointmentRequestApprovedTemplate> | ReturnType<typeof getAppointmentAssignedTechnicianTemplate>,
  data: Record<string, unknown>
) {
  const english = templateDef.translations.find((translation: { language: string }) => translation.language === 'en');
  if (!english) {
    throw new Error('English translation not found');
  }

  return Handlebars.compile(english.htmlContent)(data);
}

describe('appointment email templates', () => {
  it('renders the approved-client Teams join button only when onlineMeetingUrl is present', () => {
    const template = getAppointmentRequestApprovedTemplate();
    const baseData = {
      requesterName: 'Jane Client',
      serviceName: 'Virtual Consultation',
      appointmentDate: 'April 24, 2026',
      appointmentTime: '10:00 AM',
      duration: 30,
      technicianName: 'Alex Tech',
      minimumNoticeHours: 24,
      contactEmail: 'support@example.com',
    };

    const withMeeting = renderEnglishHtml(template, {
      ...baseData,
      onlineMeetingUrl: 'https://teams.example.com/meeting/123',
    });
    const withoutMeeting = renderEnglishHtml(template, baseData);

    expect(withMeeting).toContain('Join Teams Meeting');
    expect(withMeeting).toContain('https://teams.example.com/meeting/123');
    expect(withoutMeeting).not.toContain('Join Teams Meeting');
  });

  it('renders the assigned-technician Teams join button when onlineMeetingUrl is present', () => {
    const template = getAppointmentAssignedTechnicianTemplate();
    const html = renderEnglishHtml(template, {
      technicianName: 'Alex Tech',
      serviceName: 'Virtual Consultation',
      appointmentDate: 'April 24, 2026',
      appointmentTime: '10:00 AM',
      duration: 30,
      clientName: 'Jane Client',
      contactEmail: 'support@example.com',
      onlineMeetingUrl: 'https://teams.example.com/meeting/123',
    });

    expect(html).toContain('Join Teams Meeting');
    expect(html).toContain('https://teams.example.com/meeting/123');
  });
});
