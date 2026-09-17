import type { EmulatorPackage } from '@alga-psa/emulator-host';
import { ThreecxEmulatorCore } from './core';
import { register } from './register';
import { serve } from './serve';

const threecxEmulator: EmulatorPackage<ThreecxEmulatorCore> = {
  id: 'threecx',
  displayName: '3CX',
  defaultPort: 4070,
  createCore: (env) => new ThreecxEmulatorCore(env),
  // serve() rather than wire(): the PBX event feed is a WebSocket on the same port.
  serve: (core, port, env) => serve(core, port, env),
  register,
};

export default threecxEmulator;
export { threecxEmulator as emulator };
export { ThreecxEmulatorCore, EVENT_REMOVE, EVENT_UPSERT } from './core';
export { CALL_CONTROL_WS_PATH } from './serve';
export type {
  CallControlEvent,
  CdrSegment,
  MakeCallRecord,
  Participant,
  PbxApp,
  PbxContact,
  PbxRecording,
  PbxToken,
  PbxUser,
  ThreecxCreateContactInput,
  ThreecxExchange,
  ThreecxInboundCallInput,
  ThreecxReportChatInput,
  ThreecxTarget,
} from './core';
