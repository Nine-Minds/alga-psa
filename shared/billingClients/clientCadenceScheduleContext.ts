import type { CadenceOwner } from '@alga-psa/types';

export type ClientCadenceScheduleContext = {
  cadenceOwner: Extract<CadenceOwner, 'client'>;
  changeScopeDescription: string;
  scheduleDescription: string;
  previewDescription: string;
  previewHeading: string;
};

export const CLIENT_CADENCE_SCHEDULE_CONTEXT: ClientCadenceScheduleContext = {
  cadenceOwner: 'client',
  changeScopeDescription:
    'Configure the client billing schedule for recurring lines that invoice on the client cadence. Changes only affect future non-invoiced billing cycles.',
  scheduleDescription:
    'This schedule drives invoice windows for recurring lines that invoice on the client billing schedule. Contract-anniversary lines keep their own cadence.',
  previewDescription:
    'Previewed windows below apply to recurring lines that invoice on the client billing schedule. Contract-anniversary cadence is configured on the recurring line itself and is previewed separately.',
  previewHeading: 'Upcoming client-cadence invoice windows (preview)',
};
