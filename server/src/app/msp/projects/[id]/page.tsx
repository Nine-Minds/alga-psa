import React from 'react';
import ProjectPage from '@alga-psa/projects/components/ProjectPage';
import { MspSchedulingProvider } from '@alga-psa/msp-composition/scheduling';

export default function ProjectDetailPage(props: any) {
  return (
    <MspSchedulingProvider>
      <ProjectPage {...props} />
    </MspSchedulingProvider>
  );
}
