import {
  Tree,
  formatFiles,
  generateFiles,
  joinPathFragments,
  names,
  updateJson,
} from '@nx/devkit';
import * as path from 'path';

interface AlgaModuleGeneratorSchema {
  name: string;
  type: 'horizontal' | 'vertical';
  directory?: string;
}

export default async function algaModuleGenerator(
  tree: Tree,
  options: AlgaModuleGeneratorSchema
) {
  const { name, type = 'vertical', directory = 'packages' } = options;
  const moduleNames = names(name);
  const modulePath = joinPathFragments(directory, name);

  // Generate files from templates
  generateFiles(tree, path.join(__dirname, 'files'), modulePath, {
    ...moduleNames,
    name,
    type,
    tmpl: '',
  });

  // Add to root package.json workspaces if not already there
  updateJson(tree, 'package.json', (json) => {
    const workspaces = json.workspaces || [];
    const workspacePath = `${directory}/${name}`;
    if (!workspaces.includes(workspacePath) && !workspaces.includes(`${directory}/*`)) {
      // packages/* already exists, so no need to add individually
    }
    return json;
  });

  await formatFiles(tree);

  return () => {
    console.log(`\n✅ Module @alga-psa/${name} created successfully!`);
    console.log(`\nModule structure:`);
    console.log(`  ${modulePath}/`);
    console.log(`  ├── src/`);
    console.log(`  │   ├── actions/     # Server actions`);
    console.log(`  │   ├── components/  # React components`);
    console.log(`  │   ├── hooks/       # Custom hooks`);
    console.log(`  │   ├── lib/         # Domain logic`);
    console.log(`  │   ├── types/       # Feature types`);
    console.log(`  │   └── index.ts     # Public exports`);
    console.log(`  ├── package.json`);
    console.log(`  ├── tsconfig.json`);
    console.log(`  └── project.json`);
    console.log(`\nNext steps:`);
    console.log(`  1. Run 'npm install' to link the new package`);
    console.log(`  2. Add exports to src/index.ts`);
    console.log(`  3. Import from '@alga-psa/${name}'`);
  };
}
