import type { EmulatorPackage } from '@alga-psa/emulator-host';
import { QboEmulatorCore } from './core';
import { register } from './register';
import { wire } from './wire';

const qboEmulator: EmulatorPackage<QboEmulatorCore> = {
  id: 'qbo',
  displayName: 'QuickBooks Online',
  defaultPort: 4020,
  createCore: (env) => new QboEmulatorCore(env),
  wire,
  register,
};

export default qboEmulator;
export { qboEmulator as emulator };
export { QboEmulatorCore, QboWireError } from './core';
