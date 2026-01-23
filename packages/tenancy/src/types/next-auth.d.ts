declare module 'next-auth' {
  interface Session {
    user?: {
      tenant?: string;
    } & Record<string, unknown>;
  }
}

