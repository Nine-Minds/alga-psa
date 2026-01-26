import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable lib/services code only
    // Actions (send* functions) are runtime (Next.js transpiled)
    'index': 'src/index.ts',
    'system/SystemEmailService': 'src/system/SystemEmailService.ts',
    'system/SystemEmailProviderFactory': 'src/system/SystemEmailProviderFactory.ts',
    'system/types': 'src/system/types.ts',
    'providers/EmailProviderManager': 'src/providers/EmailProviderManager.ts',
    'providers/ResendEmailProvider': 'src/providers/ResendEmailProvider.ts',
    'providers/SMTPEmailProvider': 'src/providers/SMTPEmailProvider.ts',
    'lib/localeConfig': 'src/lib/localeConfig.ts',
    'tenant/templateProcessors': 'src/tenant/templateProcessors.ts',
    'tenant/types': 'src/tenant/types.ts',
    'BaseEmailService': 'src/BaseEmailService.ts',
    'DelayedEmailQueue': 'src/DelayedEmailQueue.ts',
    'TenantEmailService': 'src/TenantEmailService.ts',
    'TokenBucketRateLimiter': 'src/TokenBucketRateLimiter.ts',
    'templateProcessors': 'src/templateProcessors.ts',
    'emailLocaleResolver': 'src/emailLocaleResolver.ts',
    'features': 'src/features.ts',
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
    'axios',
    'knex',
    'nodemailer',
    'redis',
    'uuid',
    'zod',
  ],
});
