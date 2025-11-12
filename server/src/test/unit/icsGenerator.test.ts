import { describe, it, expect } from 'vitest';
import { generateICS, generateICSBuffer, generateICSFilename, ICSEventData } from '../../lib/utils/icsGenerator';

describe('ICS Generator', () => {
  const mockEventData: ICSEventData = {
    uid: '123e4567-e89b-12d3-a456-426614174000',
    title: 'Appointment: Network Maintenance',
    description: 'Scheduled network maintenance appointment',
    location: 'Acme Corp Office',
    startDate: new Date('2025-11-15T14:00:00Z'),
    endDate: new Date('2025-11-15T15:00:00Z'),
    organizerName: 'John Tech',
    organizerEmail: 'john@example.com',
    attendeeName: 'Jane Client',
    attendeeEmail: 'jane@client.com',
    url: 'https://example.com/appointments/123'
  };

  describe('generateICS', () => {
    it('should generate valid ICS content', () => {
      const ics = generateICS(mockEventData);

      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain('END:VCALENDAR');
      expect(ics).toContain('BEGIN:VEVENT');
      expect(ics).toContain('END:VEVENT');
      expect(ics).toContain('VERSION:2.0');
      expect(ics).toContain('PRODID:-//Alga PSA//Appointment Request//EN');
    });

    it('should include event title', () => {
      const ics = generateICS(mockEventData);

      expect(ics).toContain('SUMMARY:Appointment: Network Maintenance');
    });

    it('should include event description', () => {
      const ics = generateICS(mockEventData);

      expect(ics).toContain('DESCRIPTION:Scheduled network maintenance appointment');
    });

    it('should include location', () => {
      const ics = generateICS(mockEventData);

      expect(ics).toContain('LOCATION:Acme Corp Office');
    });

    it('should include organizer info', () => {
      const ics = generateICS(mockEventData);

      expect(ics).toContain('ORGANIZER');
      expect(ics).toContain('CN="John Tech"');
      expect(ics).toContain('mailto:john@example.com');
    });

    it('should include attendee info', () => {
      const ics = generateICS(mockEventData);

      expect(ics).toContain('ATTENDEE');
      expect(ics).toContain('CN="Jane Client"');
      expect(ics).toContain('mailto:jane@client.com');
    });

    it('should include URL', () => {
      const ics = generateICS(mockEventData);

      expect(ics).toContain('URL:https://example.com/appointments/123');
    });

    it('should include UID', () => {
      const ics = generateICS(mockEventData);

      expect(ics).toContain('UID:123e4567-e89b-12d3-a456-426614174000@algapsa.com');
    });

    it('should format dates in UTC', () => {
      const ics = generateICS(mockEventData);

      expect(ics).toContain('DTSTART:20251115T140000Z');
      expect(ics).toContain('DTEND:20251115T150000Z');
    });

    it('should escape special characters', () => {
      const eventWithSpecialChars: ICSEventData = {
        ...mockEventData,
        title: 'Test; Event, with\\nspecial chars',
        description: 'Line 1\nLine 2\rLine 3'
      };

      const ics = generateICS(eventWithSpecialChars);

      expect(ics).toContain('SUMMARY:Test\\; Event\\, with\\\\nspecial chars');
      expect(ics).toContain('DESCRIPTION:Line 1\\nLine 2Line 3');
    });

    it('should work without optional fields', () => {
      const minimalEvent: ICSEventData = {
        uid: '123',
        title: 'Minimal Event',
        startDate: new Date('2025-11-15T14:00:00Z'),
        endDate: new Date('2025-11-15T15:00:00Z')
      };

      const ics = generateICS(minimalEvent);

      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain('SUMMARY:Minimal Event');
      expect(ics).not.toContain('DESCRIPTION:');
      expect(ics).not.toContain('LOCATION:');
      expect(ics).not.toContain('ORGANIZER:');
    });

    it('should fold long lines at 75 characters', () => {
      const longTitleEvent: ICSEventData = {
        ...mockEventData,
        title: 'A'.repeat(100) // Very long title
      };

      const ics = generateICS(longTitleEvent);
      const lines = ics.split('\r\n');

      // Check that no line exceeds 75 characters (except continuation lines)
      lines.forEach(line => {
        if (!line.startsWith(' ')) {
          expect(line.length).toBeLessThanOrEqual(75);
        }
      });
    });
  });

  describe('generateICSBuffer', () => {
    it('should generate a Buffer', () => {
      const buffer = generateICSBuffer(mockEventData);

      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it('should contain valid ICS content', () => {
      const buffer = generateICSBuffer(mockEventData);
      const content = buffer.toString('utf-8');

      expect(content).toContain('BEGIN:VCALENDAR');
      expect(content).toContain('END:VCALENDAR');
    });
  });

  describe('generateICSFilename', () => {
    it('should generate a filename with .ics extension', () => {
      const filename = generateICSFilename('Network Maintenance');

      expect(filename).toContain('.ics');
    });

    it('should sanitize special characters', () => {
      const filename = generateICSFilename('Test/Event\\With:Special*Chars');

      expect(filename).not.toContain('/');
      expect(filename).not.toContain('\\');
      expect(filename).not.toContain(':');
      expect(filename).not.toContain('*');
      expect(filename).toMatch(/^[a-zA-Z0-9_-]+\.ics$/);
    });

    it('should truncate long titles', () => {
      const longTitle = 'A'.repeat(100);
      const filename = generateICSFilename(longTitle);

      // Should be truncated to 50 chars + .ics = 54 chars max
      expect(filename.length).toBeLessThanOrEqual(54);
    });

    it('should handle empty titles', () => {
      const filename = generateICSFilename('');

      expect(filename).toBe('.ics');
    });
  });

  describe('RFC 5545 Compliance', () => {
    it('should use CRLF line endings', () => {
      const ics = generateICS(mockEventData);

      // Should use \r\n, not just \n
      expect(ics).toContain('\r\n');
      expect(ics.split('\r\n').length).toBeGreaterThan(10);
    });

    it('should set METHOD to REQUEST', () => {
      const ics = generateICS(mockEventData);

      expect(ics).toContain('METHOD:REQUEST');
    });

    it('should set STATUS to CONFIRMED', () => {
      const ics = generateICS(mockEventData);

      expect(ics).toContain('STATUS:CONFIRMED');
    });

    it('should include DTSTAMP', () => {
      const ics = generateICS(mockEventData);

      expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
    });

    it('should set SEQUENCE to 0', () => {
      const ics = generateICS(mockEventData);

      expect(ics).toContain('SEQUENCE:0');
    });

    it('should set TRANSP to OPAQUE', () => {
      const ics = generateICS(mockEventData);

      expect(ics).toContain('TRANSP:OPAQUE');
    });
  });
});
