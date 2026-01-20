import type { IUser } from './auth.interfaces';

export type StorageAuthType = 'session' | 'api-key';

export interface StorageAuthContext {
  tenantId: string;
  currentUser: IUser | null;
  authType: StorageAuthType;
}

