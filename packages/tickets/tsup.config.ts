import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable lib/models/schemas/services code only
    // Actions, components, and lib/ticket-columns are runtime (Next.js transpiled)
    'index': 'src/index.ts',
    'models/ticket': 'src/models/ticket.ts',
    'models/priority': 'src/models/priority.ts',
    'models/status': 'src/models/status.ts',
    'models/board': 'src/models/board.ts',
    'models/comment': 'src/models/comment.ts',
    'schemas/ticket.schema': 'src/schemas/ticket.schema.ts',
    'lib/itilUtils': 'src/lib/itilUtils.ts',
    'lib/workflowTicketTransitionEvents': 'src/lib/workflowTicketTransitionEvents.ts',
    'lib/workflowTicketCommunicationEvents': 'src/lib/workflowTicketCommunicationEvents.ts',
    'lib/workflowTicketSlaStageEvents': 'src/lib/workflowTicketSlaStageEvents.ts',
    'lib/adapters/TicketModelEventPublisher': 'src/lib/adapters/TicketModelEventPublisher.ts',
    'lib/adapters/TicketModelAnalyticsTracker': 'src/lib/adapters/TicketModelAnalyticsTracker.ts',
    'services/itilStandardsService': 'src/services/itilStandardsService.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    /^@alga-psa\/.*/,
    'knex',
    'uuid',
    'zod',
    'react',
    'react-dom',
  ],
});
