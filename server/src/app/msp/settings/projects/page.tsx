import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import ProjectSettings from '@alga-psa/projects/components/settings/ProjectSettings';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('projects');
}

export default function ProjectsSettingsRoute() {
  return (
    <SettingsTab tabId="projects">
      <ProjectSettings />
    </SettingsTab>
  );
}
