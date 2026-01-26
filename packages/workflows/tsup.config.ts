import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable code only - actions/components/hooks are runtime (Next.js transpiled)
    'index': 'src/index.ts',
    // Models
    'models/index': 'src/models/index.ts',
    'models/BaseModel': 'src/models/BaseModel.ts',
    'models/eventCatalog': 'src/models/eventCatalog.ts',
    'models/workflowTrigger': 'src/models/workflowTrigger.ts',
    'models/workflowEventAttachment': 'src/models/workflowEventAttachment.ts',
    'models/workflowEventMapping': 'src/models/workflowEventMapping.ts',
    // Config
    'config/workflowConfig': 'src/config/workflowConfig.ts',
    // Lib
    'lib/workflowValidation': 'src/lib/workflowValidation.ts',
    'lib/templateUtils': 'src/lib/templateUtils.ts',
    'lib/templateVariables': 'src/lib/templateVariables.ts',
    // Forms (pure logic, no React)
    'forms/actionHandlerRegistry': 'src/forms/actionHandlerRegistry.ts',
    'forms/conditionalLogic': 'src/forms/conditionalLogic.ts',
    // Visualization AST types (pure TypeScript types)
    'visualization/types/astTypes': 'src/visualization/types/astTypes.ts',
    // Visualization AST utilities
    'visualization/ast/index': 'src/visualization/ast/index.ts',
    'visualization/ast/astParser': 'src/visualization/ast/astParser.ts',
    'visualization/ast/workflowAnalyzer': 'src/visualization/ast/workflowAnalyzer.ts',
    'visualization/ast/flowGraphBuilder': 'src/visualization/ast/flowGraphBuilder.ts',
    'visualization/ast/nodeVisitors/stateTransitionVisitor': 'src/visualization/ast/nodeVisitors/stateTransitionVisitor.ts',
    'visualization/ast/nodeVisitors/actionVisitor': 'src/visualization/ast/nodeVisitors/actionVisitor.ts',
    'visualization/ast/nodeVisitors/eventVisitor': 'src/visualization/ast/nodeVisitors/eventVisitor.ts',
    'visualization/ast/nodeVisitors/conditionalVisitor': 'src/visualization/ast/nodeVisitors/conditionalVisitor.ts',
    'visualization/ast/nodeVisitors/loopVisitor': 'src/visualization/ast/nodeVisitors/loopVisitor.ts',
    'visualization/ast/nodeVisitors/parallelVisitor': 'src/visualization/ast/nodeVisitors/parallelVisitor.ts',
    // Schemas (pure Zod)
    'actions/workflow-runtime-v2-schemas': 'src/actions/workflow-runtime-v2-schemas.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    // All @alga-psa packages should be external (resolved at runtime)
    /^@alga-psa\/.*/,
    /^@shared\/.*/,
    'knex',
    'zod',
    'zod-to-json-schema',
    'parsimmon',
    'ts-morph',
    'elkjs',
    'react',
    'react-dom',
    'reactflow',
    'next',
    'next/navigation',
    'next/link',
    'next-auth',
    'next-auth/react',
    '@rjsf/utils',
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
