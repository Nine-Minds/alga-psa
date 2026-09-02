import type { EmulatorPackage } from '@alga-psa/emulator-host';
import { ThreecxEmulatorCore } from './core';
import { register } from './register';
import { wire } from './wire';

const threecxEmulator: EmulatorPackage<ThreecxEmulatorCore> = {
  id: 'threecx',
  displayName: '3CX',
  defaultPort: 4070,
  createCore: (env) => new ThreecxEmulatorCore(env),
  wire,
  register,
};

export default threecxEmulator;
export { threecxEmulator as emulator };
export { ThreecxEmulatorCore } from './core';
export type { ThreecxExchange, ThreecxInboundCallInput, ThreecxTarget } from './core';
