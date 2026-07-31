import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { getSettingsTabTitle } from '@/components/settings/settingsTabsRegistry';
import ProjectSettings from '@alga-psa/projects/components/settings/ProjectSettings';

export const metadata: Metadata = { title: getSettingsTabTitle('projects') };

export default function ProjectsSettingsRoute() {
  return (
    <SettingsTab tabId="projects">
      <ProjectSettings />
    </SettingsTab>
  );
}
