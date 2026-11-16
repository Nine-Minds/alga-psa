import type { EmulatorPackage } from '@alga-psa/emulator-host';
import { GoogleCalendarCore } from './core';
import { register } from './register';
import { wire } from './wire';

const googleCalendarEmulator: EmulatorPackage<GoogleCalendarCore> = {
  id: 'google-calendar',
  displayName: 'Google Calendar',
  defaultPort: 4100,
  createCore: (env) => new GoogleCalendarCore(env),
  wire,
  register,
};

export default googleCalendarEmulator;
export { googleCalendarEmulator as emulator };
export { GoogleCalendarApiError, GoogleCalendarCore } from './core';
export type { GoogleCalendarEvent, GoogleEventDate, ListEventsInput, ListEventsResult } from './core';
