import type { EmulatorPackage } from '@alga-psa/emulator-host';
import { XeroEmulatorCore } from './core';
import { register } from './register';
import { wire } from './wire';

const xeroEmulator: EmulatorPackage<XeroEmulatorCore> = {
  id: 'xero',
  displayName: 'Xero',
  defaultPort: 4060,
  createCore: (env) => new XeroEmulatorCore(env),
  wire,
  register,
};

export default xeroEmulator;
export { xeroEmulator as emulator };
export { XeroEmulatorCore, XeroWireError } from './core';
