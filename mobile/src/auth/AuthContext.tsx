import { createContext, useContext } from "react";

export type MobileSession = {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
  tenantId?: string;
  user?: { id: string; email?: string; name?: string };
};

export type AuthContextValue = {
  session: MobileSession | null;
  setSession: (session: MobileSession | null) => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within an AuthContext provider");
  return value;
}

