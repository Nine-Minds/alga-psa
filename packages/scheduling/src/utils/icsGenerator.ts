/**
 * ICS (iCalendar) File Generator
 * Generates RFC 5545 compliant .ics calendar files for appointments
 */

export interface ICSEventData {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  organizerName?: string;
  organizerEmail?: string;
  attendeeName?: string;
  attendeeEmail?: string;
  url?: string;
}

/**
 * Format a date for ICS file (YYYYMMDDTHHMMSSZ format in UTC)
 */
function formatICSDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Escape special characters in ICS text fields
 */
function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')    // Backslash
    .replace(/;/g, '\\;')       // Semicolon
    .replace(/,/g, '\\,')       // Comma
    .replace(/\n/g, '\\n')      // Newline
    .replace(/\r/g, '');        // Remove carriage return
}

/**
 * Fold long lines to 75 characters as per RFC 5545
 * Lines should be folded at 75 characters by inserting CRLF + space
 */
function foldLine(line: string): string {
  if (line.length <= 75) {
    return line;
  }

  const folded: string[] = [];
  let currentLine = line;

  while (currentLine.length > 75) {
    folded.push(currentLine.substring(0, 75));
    currentLine = ' ' + currentLine.substring(75); // Add space prefix for continuation
  }

  if (currentLine.length > 0) {
    folded.push(currentLine);
  }

  return folded.join('\r\n');
}

/**
 * Generate an ICS file content for a calendar event
 */
export function generateICS(eventData: ICSEventData): string {
  const now = new Date();
  const dtstamp = formatICSDate(now);
  const dtstart = formatICSDate(eventData.startDate);
  const dtend = formatICSDate(eventData.endDate);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Alga PSA//Appointment Request//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${eventData.uid}@algapsa.com`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    foldLine(`SUMMARY:${escapeICSText(eventData.title)}`),
  ];

  if (eventData.description) {
    lines.push(foldLine(`DESCRIPTION:${escapeICSText(eventData.description)}`));
  }

  if (eventData.location) {
    lines.push(foldLine(`LOCATION:${escapeICSText(eventData.location)}`));
  }

  if (eventData.url) {
    lines.push(foldLine(`URL:${eventData.url}`));
  }

  if (eventData.organizerEmail) {
    const organizerName = eventData.organizerName ? escapeICSText(eventData.organizerName) : '';
    lines.push(foldLine(`ORGANIZER;CN="${organizerName}":mailto:${eventData.organizerEmail}`));
  }

  if (eventData.attendeeEmail) {
    const attendeeName = eventData.attendeeName ? escapeICSText(eventData.attendeeName) : '';
    lines.push(
      foldLine(`ATTENDEE;CN="${attendeeName}";RSVP=TRUE;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT:mailto:${eventData.attendeeEmail}`)
    );
  }

  lines.push(
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR'
  );

  return lines.join('\r\n');
}

/**
 * Generate an ICS file as a Buffer for email attachment
 */
export function generateICSBuffer(eventData: ICSEventData): Buffer {
  const icsContent = generateICS(eventData);
  return Buffer.from(icsContent, 'utf-8');
}

/**
 * Generate filename for ICS file
 */
export function generateICSFilename(title: string): string {
  // Sanitize title for filename
  const sanitized = title
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .substring(0, 50);

  return `${sanitized}.ics`;
}
