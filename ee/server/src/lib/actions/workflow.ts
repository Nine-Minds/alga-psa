'use server'

import { createTenantKnex } from '@/lib/db'
import { WorkflowVersionResponse } from '../../services/flow/types'

export async function fetchWorkflowVersion(
  workflowId: number,
  tenant: string,
  version?: number
): Promise<WorkflowVersionResponse> {
  const {knex} = await createTenantKnex();

  try {
    // Get workflow and version info
    const workflowQuery = knex('workflows as w')
      .select(
        'w.id',
        'w.created_at as workflow_created_at',
        'w.updated_at as workflow_updated_at',
        'w.enabled',
        'wv.id as version_id',
        'wv.version',
        'wv.name',
        'wv.description',
        'wv.execution_graph',
        'wv.created_at as version_created_at'
      )
      .join('workflow_versions as wv', function() {
        if (version !== undefined) {
          this.on('w.id', '=', 'wv.workflow_id')
            .andOn('wv.version', '=', knex.raw('?', [version]))
        } else {
          this.on('w.latest_version_id', '=', 'wv.id')
        }
      })
      .where('w.id', workflowId)
      .first()

    const workflowData = await workflowQuery

    if (!workflowData) {
      throw new Error('Workflow or version not found')
    }

    // Get nodes with properties and outputs
    const nodes = await knex('node_versions as nv')
      .select(
        'nv.*',
        knex.raw(`
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'id', npv.id,
                'node_version_id', npv.node_version_id,
                'key', npv.key,
                'value', npv.value,
                'created_at', npv.created_at
              )
            ) FILTER (WHERE npv.id IS NOT NULL),
            '[]'
          ) as properties
        `),
        knex.raw(`
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'id', nov.id,
                'node_version_id', nov.node_version_id,
                'output_key', nov.output_key,
                'label', nov.label,
                'created_at', nov.created_at
              )
            ) FILTER (WHERE nov.id IS NOT NULL),
            '[]'
          ) as outputs
        `)
      )
      .leftJoin('node_property_versions as npv', 'nv.id', 'npv.node_version_id')
      .leftJoin('node_output_versions as nov', 'nv.id', 'nov.node_version_id')
      .where('nv.workflow_version_id', workflowData.version_id)
      .groupBy('nv.id')

    // Get edges
    const edges = await knex('edge_versions')
      .select('*')
      .where('workflow_version_id', workflowData.version_id)

    const response: WorkflowVersionResponse = {
      id: workflowData.version_id,
      workflow_id: workflowData.id,
      version: version ?? 0,
      name: workflowData.name,
      description: workflowData.description,
      execution_graph: workflowData.execution_graph,
      created_at: workflowData.version_created_at,
      workflow: {
        id: workflowData.id,
        created_at: workflowData.workflow_created_at,
        updated_at: workflowData.workflow_updated_at,
        enabled: workflowData.enabled
      },
      nodes: nodes.map(node => ({
        ...node,
        properties: node.properties || [],
        outputs: node.outputs || []
      })),
      edges
    }

    return response
  } finally {
    await knex.destroy()
  }
}
