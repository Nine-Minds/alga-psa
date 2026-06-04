import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { workflowEventPayloadSchemas } from '../schemas/workflowEventPayloadSchemas';

type ReferenceStep = {
  id?: string;
  type: string;
  config?: Record<string, unknown>;
  items?: unknown;
  itemVar?: string;
  body?: ReferenceStep[];
};

type ReferenceWorkflow = {
  key: string;
  metadata: {
    trigger: Record<string, unknown>;
    payloadSchemaRef: string;
  };
  draft: {
    definition: {
      steps: ReferenceStep[];
    };
  };
};

const repoRoot = path.resolve(__dirname, '../../../../');
const bundlePath = path.join(
  repoRoot,
  'ee/test-data/workflow-bundles/workflow-data-store-task-mirror.v1.json',
);

const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8')) as {
  format: string;
  workflows: ReferenceWorkflow[];
};

describe('workflow data-store reference workflows', () => {
  it('T015/F020: link-setup and mirror workflows demonstrate cross-run entity mapping', () => {
    expect(bundle.format).toBe('alga-psa.workflow-bundle');
    expect(bundle.workflows.map((workflow) => workflow.key)).toEqual([
      'reference.project-task-mirror-link-setup',
      'reference.project-task-mirror-sync',
    ]);

    const setup = bundle.workflows[0];
    expect(setup.metadata.trigger).toEqual({ type: 'event', eventName: 'PROJECT_TASK_CREATED' });
    expect(setup.metadata.payloadSchemaRef).toBe('payload.ProjectTaskCreated.v1');
    expect(workflowEventPayloadSchemas['payload.ProjectTaskCreated.v1']).toBeDefined();

    const setupSteps = setup.draft.definition.steps;
    const createMirrorTask = setupSteps.find((step) => step.id === 'create-mirror-task');
    const persistTaskLink = setupSteps.find((step) => step.id === 'persist-task-link');

    expect(createMirrorTask).toMatchObject({
      type: 'action.call',
      config: {
        actionId: 'projects.create_task',
        saveAs: 'vars.createdMirrorTask',
      },
    });
    expect(persistTaskLink).toMatchObject({
      type: 'action.call',
      config: {
        actionId: 'links.upsert',
        inputMapping: {
          namespace: 'project-task-mirror',
          left: { type: 'project_task', id: { $expr: 'payload.taskId' } },
          right: { type: 'project_task', id: { $expr: 'vars.createdMirrorTask.task_id' } },
          relation: 'mirrors',
        },
        saveAs: 'vars.persistedMirrorLink',
      },
    });

    const mirror = bundle.workflows[1];
    expect(mirror.metadata.trigger).toEqual({ type: 'event', eventName: 'PROJECT_TASK_UPDATED' });
    expect(mirror.metadata.payloadSchemaRef).toBe('payload.ProjectTaskUpdated.v1');
    expect(workflowEventPayloadSchemas['payload.ProjectTaskUpdated.v1']).toBeDefined();

    const mirrorSteps = mirror.draft.definition.steps;
    const lookup = mirrorSteps.find((step) => step.id === 'lookup-linked-tasks');
    const forEach = mirrorSteps.find((step) => step.id === 'for-each-linked-task');

    expect(lookup).toMatchObject({
      type: 'action.call',
      config: {
        actionId: 'links.lookup',
        inputMapping: {
          namespace: 'project-task-mirror',
          from: { type: 'project_task', id: { $expr: 'payload.taskId' } },
          direction: 'forward',
          relation: 'mirrors',
        },
        saveAs: 'vars.linkedTasks',
      },
    });
    expect(forEach).toMatchObject({
      type: 'control.forEach',
      items: { $expr: 'vars.linkedTasks.matches' },
      itemVar: 'match',
      body: [
        {
          type: 'action.call',
          config: {
            actionId: 'projects.update_task',
            inputMapping: {
              task_id: { $expr: 'vars.match.id' },
            },
          },
        },
      ],
    });
  });
});
