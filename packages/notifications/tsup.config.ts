import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable lib/types code only
    // Actions, components, and hooks are runtime (Next.js transpiled)
    'index': 'src/index.ts',
    'db': 'src/db.ts',
    'emailChannel': 'src/emailChannel.ts',
    'types/internalNotification': 'src/types/internalNotification.ts',
    'types/notification': 'src/types/notification.ts',
    'lib/authHelpers': 'src/lib/authHelpers.ts',
    'realtime/internalNotificationBroadcaster': 'src/realtime/internalNotificationBroadcaster.ts',
    'notifications/emailLocaleResolver': 'src/notifications/emailLocaleResolver.ts',
    'notifications/email': 'src/notifications/email.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    '@alga-psa/core',
    '@alga-psa/db',
    '@alga-psa/types',
    '@alga-psa/ui',
    '@alga-psa/validation',
    '@alga-psa/auth',
    'knex',
    'uuid',
    'zod',
    'react',
    'react-dom',
  ],
});
