// src/shared/utils/workflowToSql.ts

import { Workflow } from './workflowParser';
import { v4 as uuidv4 } from 'uuid';

export function workflowToSql(workflow: Workflow): string[] {
  const statements: string[] = [];
  const workflowId = 1;
  const versionId = 1;

  // Create workflow
  statements.push(`
    INSERT INTO workflows (id, enabled)
    VALUES ('${workflowId}', false);
  `);

  // Create workflow version
  statements.push(`
    INSERT INTO workflow_versions (id, workflow_id, version, name, description)
    VALUES ('${versionId}', '${workflowId}', 1, '${workflow.name}', '${workflow.description}');
  `);

  // Update workflow with latest version
  statements.push(`
    UPDATE workflows
    SET latest_version_id = '${versionId}'
    WHERE id = '${workflowId}';
  `);

  let propertyCounter = 0;
  let edgeCounter = 0;
  // Create nodes
  workflow.nodes.forEach((node, workflow_idx) => {
    const nodeId = uuidv4();
    const nodeVersionId = workflow_idx + 1;

    statements.push(`
      INSERT INTO nodes (id, workflow_id, latest_version_id)
      VALUES ('${nodeId}', '${workflowId}', '${nodeVersionId}');
    `);

    statements.push(`
      INSERT INTO node_versions (id, workflow_version_id, node_id, type, label, x_position, y_position)
      VALUES ('${nodeVersionId}', '${versionId}', '${nodeId}', '${node.type}', '${node.name}', ${node.position[0]}, ${node.position[1]});
    `);

    // Create node properties
    Object.entries(node.properties).forEach(([key, value]) => {
        propertyCounter++;
        const propertyId = propertyCounter;
        const propertyVersionId = propertyCounter;
      
        statements.push(`
          INSERT INTO node_properties (id, node_id)
          VALUES ('${propertyId}', '${nodeId}');
        `);
      
        statements.push(`
          INSERT INTO node_property_versions (id, node_version_id, key, value)
          VALUES ('${propertyVersionId}', '${nodeVersionId}', '${key}', '${value}');
        `);
      });
  });

  // Create edges
  workflow.edges.forEach((edge, index) => {
    edgeCounter++;
    const edgeId = uuidv4();
    const edgeVersionId = edgeCounter;

    statements.push(`
      INSERT INTO edges (id, workflow_id, latest_version_id)
      VALUES ('${edgeId}', '${workflowId}', '${edgeVersionId}');
    `);

    statements.push(`
      INSERT INTO edge_versions (id, workflow_version_id, edge_id, source_node_id, target_node_id)
      VALUES (
        '${edgeVersionId}',
        '${versionId}',
        '${edgeId}',
        (SELECT id FROM nodes WHERE workflow_id = '${workflowId}' AND label = '${edge.from}'),
        (SELECT id FROM nodes WHERE workflow_id = '${workflowId}' AND label = '${edge.to}')
      );
    `);
  });

  return statements;
}
