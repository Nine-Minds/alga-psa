import { IframeBridge } from './bridge';

export function navigate(bridge: IframeBridge, path: string) {
  bridge.emitToHost('navigate', { path });
}

