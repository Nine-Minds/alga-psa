import msgraph from '@alga-psa/emulator-msgraph';
import qbo from '@alga-psa/emulator-qbo';
import smtpSink from '@alga-psa/emulator-smtp-sink';
import webhookSink from '@alga-psa/emulator-webhook-sink';
import type { EmulatorPackage } from '@alga-psa/emulator-host';

/** Every emulator in the suite. New emulators register here. */
export const SUITE_EMULATORS: EmulatorPackage[] = [
  msgraph as EmulatorPackage,
  qbo as EmulatorPackage,
  webhookSink as EmulatorPackage,
  smtpSink as EmulatorPackage,
];
