import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('appointment request Teams transaction discipline', () => {
  const source = readFileSync(
    resolve(process.cwd(), '../packages/scheduling/src/actions/appointmentRequestManagementActions.ts'),
    'utf8'
  );

  it('creates Teams meetings before the approval write transaction consumes the result', () => {
    const createIndex = source.indexOf('preparedTeamsMeeting = await teamsMeetingService.createTeamsMeeting');
    const writeTransactionIndex = source.indexOf('result = await withTransaction');

    expect(createIndex).toBeGreaterThan(-1);
    expect(writeTransactionIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeLessThan(writeTransactionIndex);

    const approvalWriteTransaction = source.slice(
      writeTransactionIndex,
      source.indexOf('createdMeetingForCompensation = null', writeTransactionIndex)
    );
    expect(approvalWriteTransaction).not.toContain('.createTeamsMeeting(');
  });

  it('keeps reschedule Graph updates after the DB transaction returns', () => {
    const rescheduleStart = source.indexOf('export const updateAppointmentRequestDateTime');
    const rescheduleSource = source.slice(rescheduleStart);
    const transactionIndex = rescheduleSource.indexOf('const result = await withTransaction');
    const updateIndex = rescheduleSource.indexOf('teamsMeetingService.updateTeamsMeeting(result.teamsMeetingUpdateInput)');

    expect(rescheduleStart).toBeGreaterThan(-1);
    expect(transactionIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(transactionIndex);

    const rescheduleTransaction = rescheduleSource.slice(
      transactionIndex,
      rescheduleSource.indexOf('let teamsMeetingWarning', transactionIndex)
    );
    expect(rescheduleTransaction).not.toContain('.updateTeamsMeeting(');
  });

  it('keeps schedule delete Graph calls after the DB transaction returns', () => {
    const scheduleSource = readFileSync(
      resolve(process.cwd(), '../packages/scheduling/src/actions/scheduleActions.ts'),
      'utf8'
    );
    const deleteStart = scheduleSource.indexOf('export const deleteScheduleEntry');
    const deleteSource = scheduleSource.slice(deleteStart);
    const transactionIndex = deleteSource.indexOf('await withTransaction(db');
    const deleteTeamsIndex = deleteSource.indexOf('teamsMeetingService.deleteTeamsMeeting');

    expect(deleteStart).toBeGreaterThan(-1);
    expect(transactionIndex).toBeGreaterThan(-1);
    expect(deleteTeamsIndex).toBeGreaterThan(-1);
    expect(deleteTeamsIndex).toBeGreaterThan(transactionIndex);

    const deleteTransaction = deleteSource.slice(
      transactionIndex,
      deleteSource.indexOf('const teamsMeetingId', transactionIndex)
    );
    expect(deleteTransaction).not.toContain('.deleteTeamsMeeting(');
  });
});
