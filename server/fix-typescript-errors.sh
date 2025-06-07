#!/bin/bash

echo "Fixing TypeScript compilation errors..."

# 1. Fix transaction handling in projectTask.ts
echo "Fixing projectTask.ts transaction handling..."
sed -i '199s/!knexOrTrx.isTransaction/!isTransaction/' src/lib/models/projectTask.ts
sed -i '203s/!knexOrTrx.isTransaction/!isTransaction/' src/lib/models/projectTask.ts
sed -i '286s/!knexOrTrx.isTransaction/!isTransaction/' src/lib/models/projectTask.ts
sed -i '290s/!knexOrTrx.isTransaction/!isTransaction/' src/lib/models/projectTask.ts

# Check if isTransaction variable exists in deleteTask function
if ! grep -q "const isTransaction = (knexOrTrx as any).isTransaction || false;" src/lib/models/projectTask.ts; then
    echo "Adding isTransaction variable to projectTask.ts functions..."
    # This needs manual fixing as we need to add it in the right place
fi

# 2. Fix transaction handling in team.tsx
echo "Fixing team.tsx transaction handling..."
sed -i '141s/!knexOrTrx.isTransaction/!isTransaction/' src/lib/models/team.tsx
sed -i '145s/!knexOrTrx.isTransaction/!isTransaction/' src/lib/models/team.tsx

# 3. Fix getCurrentTenantId import in projectTask.ts
echo "Fixing getCurrentTenantId import..."
sed -i "s/from '\.\.\/tenant'/from '..\/db'/" src/lib/models/projectTask.ts

echo "Script complete. Manual fixes still needed for:"
echo "1. Add isTransaction variable declarations where missing"
echo "2. Update interfaces to add missing properties"
echo "3. Fix function calls to include knex parameter"
echo "4. Add type annotations to workflow tests"