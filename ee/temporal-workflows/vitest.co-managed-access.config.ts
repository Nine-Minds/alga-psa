import base from './vitest.co-managed.config';
import server from '../../server/vitest.config';
import path from 'node:path';
export default {
  ...base,
  resolve: { ...base.resolve, alias: [
    { find: /^@alga-psa\/tags$/, replacement: path.resolve(__dirname, '../../packages/tags/src/index.ts') },
    { find: /^@alga-psa\/inventory\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/inventory/src')}/$1` },
    { find: /^@alga-psa\/tags\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/tags/src')}/$1` },
    { find: /^@alga-psa\/ui\/lib\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/ui/src/lib')}/$1` },
    { find: /^@\/(.*)$/, replacement: `${path.resolve(__dirname, '../../server/src')}/$1` },
    { find: /^server\/src\/(.*)$/, replacement: `${path.resolve(__dirname, '../../server/src')}/$1` },
    ...(server.resolve?.alias as any[]).filter(alias => alias.find !== 'next/server'),
    ...(base.resolve?.alias ?? []),
  ] },
  test: { ...base.test, include: ['src/__tests__/integration/coManagedNativeAccess.integration.test.ts'] },
};
