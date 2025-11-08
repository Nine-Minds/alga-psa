export interface CreateUiProjectOptions {
  name: string;
  directory?: string;
}

import { createNewProject } from './create-new-project.js';

export async function createUiProject(options: CreateUiProjectOptions): Promise<void> {
  const { name, directory } = options;
  if (!name || name.trim().length === 0) {
    throw new Error('Project name is required');
  }
  await createNewProject({ name, template: 'ui-gallery', directory });
}
