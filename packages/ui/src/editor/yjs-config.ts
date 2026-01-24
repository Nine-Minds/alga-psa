import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

const HOCUSPOCUS_URL = process.env.HOCUSPOCUS_URL || 'http://localhost';
const HOCUSPOCUS_PORT = process.env.HOCUSPOCUS_PORT || '1234';

export const createYjsProvider = (roomName: string) => {
  const ydoc = new Y.Doc();
  const provider = new HocuspocusProvider({
    // url: 'https://testing2.idgomezj.com/',
    // url: 'http://localhost:1234/',             // for local development
    url: `${HOCUSPOCUS_URL}:${HOCUSPOCUS_PORT}/`, // for production
    name: roomName,
    document: ydoc,

    // Uncomment for debugging
    // onConnect: () => console.log('Connected to Hocuspocus server, room:', roomName),
    // onDisconnect: (data) => console.log('Disconnected from Hocuspocus server, room:', roomName, "\nData:", data),
    // onDestroy: () => console.log('Hocuspocus provider destroyed, room:', roomName),
  });

  return { ydoc, provider };
};
