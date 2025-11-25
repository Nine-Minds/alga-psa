import 'next/server';

declare module 'next/server' {
  interface NextRequest {
    ip?: string;
  }
}
