import { defineConfig } from 'tsup';
import { makeConfig } from '../build-tools/tsup-preset';

export default defineConfig(makeConfig({
  jsxEnabled: true,
  external: ['react', 'react-dom', 'next', 'next/navigation', 'next/link', 'next-auth', 'next-auth/react'],
}));
