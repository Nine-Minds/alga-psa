#!/bin/bash
# Create a new feature package scaffold
#
# Usage: ./scripts/create-feature-package.sh <feature-name>
# Example: ./scripts/create-feature-package.sh clients

set -e

FEATURE_NAME=$1

if [ -z "$FEATURE_NAME" ]; then
    echo "Usage: $0 <feature-name>"
    echo "Example: $0 clients"
    exit 1
fi

FEATURE_DIR="features/$FEATURE_NAME"

if [ -d "$FEATURE_DIR" ]; then
    echo "Error: Feature '$FEATURE_NAME' already exists at $FEATURE_DIR"
    exit 1
fi

echo "Creating feature package: @alga-psa/feature-$FEATURE_NAME"

# Create directory structure
mkdir -p "$FEATURE_DIR/src"/{actions,components,api,repositories,types}

# Create package.json
cat > "$FEATURE_DIR/package.json" << EOF
{
  "name": "@alga-psa/feature-$FEATURE_NAME",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./actions": {
      "types": "./dist/actions/index.d.ts",
      "import": "./dist/actions/index.js"
    },
    "./components": {
      "types": "./dist/components/index.d.ts",
      "import": "./dist/components/index.js"
    },
    "./api": {
      "types": "./dist/api/index.d.ts",
      "import": "./dist/api/index.js"
    },
    "./repositories": {
      "types": "./dist/repositories/index.d.ts",
      "import": "./dist/repositories/index.js"
    },
    "./types": {
      "types": "./dist/types/index.d.ts",
      "import": "./dist/types/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18",
    "typescript": "^5.7.3",
    "vitest": "^3.2.4"
  },
  "peerDependencies": {
    "@alga-psa/database": "*",
    "@alga-psa/shared": "*",
    "react": "^18"
  }
}
EOF

# Create tsconfig.json
cat > "$FEATURE_DIR/tsconfig.json" << EOF
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "composite": true,
    "noEmit": false,
    "baseUrl": ".",
    "paths": {
      "@alga-psa/database": ["../packages/database"],
      "@alga-psa/database/*": ["../packages/database/*"],
      "@alga-psa/shared": ["../packages/shared"],
      "@alga-psa/shared/*": ["../packages/shared/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.test.tsx"]
}
EOF

# Create src/index.ts
cat > "$FEATURE_DIR/src/index.ts" << EOF
/**
 * @alga-psa/feature-$FEATURE_NAME
 *
 * ${FEATURE_NAME^} feature package for Alga PSA.
 */

// Export actions
export * from './actions/index.js';

// Export types
export * from './types/index.js';

// Re-export repository for convenience
// export { ${FEATURE_NAME}Repository } from './repositories/index.js';
EOF

# Create src/types/index.ts
cat > "$FEATURE_DIR/src/types/index.ts" << EOF
import { z } from 'zod';

/**
 * ${FEATURE_NAME^} entity
 */
export interface ${FEATURE_NAME^} {
  id: string;
  tenant: string;
  // Add fields here
  created_at: Date;
  updated_at: Date;
}

/**
 * Input schema for creating a new ${FEATURE_NAME}
 */
export const create${FEATURE_NAME^}Schema = z.object({
  // Add fields here
});

export type Create${FEATURE_NAME^}Input = z.infer<typeof create${FEATURE_NAME^}Schema>;

/**
 * Input schema for updating an existing ${FEATURE_NAME}
 */
export const update${FEATURE_NAME^}Schema = create${FEATURE_NAME^}Schema.partial().extend({
  id: z.string().uuid(),
});

export type Update${FEATURE_NAME^}Input = z.infer<typeof update${FEATURE_NAME^}Schema>;

/**
 * Filters for querying ${FEATURE_NAME}
 */
export interface ${FEATURE_NAME^}Filters {
  search?: string;
  limit?: number;
  offset?: number;
}
EOF

# Create src/actions/index.ts
cat > "$FEATURE_DIR/src/actions/index.ts" << EOF
/**
 * ${FEATURE_NAME^} server actions
 */

'use server';

// import { create${FEATURE_NAME^}Repository } from '../repositories/index.js';
import type { ${FEATURE_NAME^}, ${FEATURE_NAME^}Filters } from '../types/index.js';

type Knex = import('knex').Knex;

interface ActionContext {
  tenantId: string;
  userId: string;
  knex: Knex;
}

/**
 * Get a list of ${FEATURE_NAME} for the current tenant
 */
export async function get${FEATURE_NAME^}List(
  context: ActionContext,
  filters: ${FEATURE_NAME^}Filters = {}
): Promise<${FEATURE_NAME^}[]> {
  // TODO: Implement
  throw new Error('Not implemented');
}

/**
 * Get a single ${FEATURE_NAME} by ID
 */
export async function get${FEATURE_NAME^}(
  context: ActionContext,
  id: string
): Promise<${FEATURE_NAME^} | null> {
  // TODO: Implement
  throw new Error('Not implemented');
}
EOF

# Create src/repositories/index.ts
cat > "$FEATURE_DIR/src/repositories/index.ts" << EOF
/**
 * ${FEATURE_NAME^} repository - data access layer
 */

import type { Knex } from 'knex';
import type { ${FEATURE_NAME^}, Create${FEATURE_NAME^}Input, Update${FEATURE_NAME^}Input } from '../types/index.js';

const TABLE_NAME = '${FEATURE_NAME}'; // Update with actual table name

export function create${FEATURE_NAME^}Repository(knex: Knex) {
  return {
    async findById(tenantId: string, id: string): Promise<${FEATURE_NAME^} | null> {
      const result = await knex(TABLE_NAME)
        .where({ tenant: tenantId, id })
        .first();
      return result || null;
    },

    async findMany(tenantId: string): Promise<${FEATURE_NAME^}[]> {
      return knex(TABLE_NAME).where({ tenant: tenantId });
    },

    async create(tenantId: string, input: Create${FEATURE_NAME^}Input): Promise<${FEATURE_NAME^}> {
      const [result] = await knex(TABLE_NAME)
        .insert({
          ...input,
          tenant: tenantId,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('*');
      return result;
    },

    async update(tenantId: string, input: Update${FEATURE_NAME^}Input): Promise<${FEATURE_NAME^} | null> {
      const { id, ...updateData } = input;
      const [result] = await knex(TABLE_NAME)
        .where({ tenant: tenantId, id })
        .update({ ...updateData, updated_at: new Date() })
        .returning('*');
      return result || null;
    },

    async delete(tenantId: string, id: string): Promise<boolean> {
      const result = await knex(TABLE_NAME)
        .where({ tenant: tenantId, id })
        .delete();
      return result > 0;
    },
  };
}

export const ${FEATURE_NAME}Repository = {
  create: create${FEATURE_NAME^}Repository,
};
EOF

# Create src/components/index.ts
cat > "$FEATURE_DIR/src/components/index.ts" << EOF
/**
 * ${FEATURE_NAME^} React components
 *
 * Export your feature's UI components here.
 */

// Example:
// export { ${FEATURE_NAME^}List } from './${FEATURE_NAME^}List.js';
// export { ${FEATURE_NAME^}Form } from './${FEATURE_NAME^}Form.js';
EOF

# Create src/api/index.ts
cat > "$FEATURE_DIR/src/api/index.ts" << EOF
/**
 * ${FEATURE_NAME^} API route handlers
 *
 * These can be imported into the server's app/api routes.
 */

// Example:
// export { GET, POST } from './route.js';
EOF

echo ""
echo "Feature package created successfully!"
echo ""
echo "Next steps:"
echo "  1. Run 'npm install' to link the new package"
echo "  2. Update src/types/index.ts with your entity fields"
echo "  3. Update src/repositories/index.ts with the correct table name"
echo "  4. Implement the actions in src/actions/index.ts"
echo "  5. Build with: npm run build -- --filter=@alga-psa/feature-$FEATURE_NAME"
echo ""
