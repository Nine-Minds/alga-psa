import { defineConfig } from 'tsup';
import { makeConfig } from '../build-tools/tsup-preset';

export default defineConfig(makeConfig({
  jsxEnabled: true,
  external: [
    'react', 'react-dom',
    'next', 'next/link', 'next/navigation', 'next/headers', 'next/server',
    'next-auth', 'next-auth/react', 'next-auth/providers/credentials', 'next-auth/providers/google',
    '@auth/core',
  ],
}));
