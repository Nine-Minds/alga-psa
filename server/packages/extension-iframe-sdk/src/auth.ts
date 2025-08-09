import { IframeBridge } from './bridge';

export async function getToken(bridge: IframeBridge): Promise<string> {
  return new Promise((resolve) => {
    const off = bridge.on((evt: any) => {
      if (evt.type === 'auth' && evt.payload?.token) {
        off();
        resolve(evt.payload.token);
      }
    });
    bridge.emitToHost('auth.request', {});
  });
}

