import { 
  ICMDBVisualizationGraph, 
  ICMDBVisualizationNode, 
  ICMDBVisualizationEdge,
  IDependencyPath,
  IImpactVisualization,
  ICMDBLayoutSettings,
  ICMDBFilter,
  ICMDBSearchResult,
  ICMDBExportOptions
} from '../../interfaces/cmdb.visualization.interfaces';
import { IConfigurationItem, ICIRelationship } from '../../interfaces/cmdb.interfaces';
import knex from '../db';
import { CMDBService } from './cmdbService';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

export class CMDBVisualizationService {
  private cmdbService: CMDBService;

  constructor() {
    this.cmdbService = new CMDBService();
  }

  async generateDependencyGraph(
    centerCIId: string,
    maxDepth: number = 3,
    filters?: ICMDBFilter,
    layoutSettings?: ICMDBLayoutSettings
  ): Promise<ICMDBVisualizationGraph> {
    const centerCI = await this.cmdbService.getConfigurationItem(centerCIId);
    if (!centerCI) {
      throw new Error(`Configuration Item ${centerCIId} not found`);
    }

    const visitedNodes = new Set<string>();
    const nodes: ICMDBVisualizationNode[] = [];
    const edges: ICMDBVisualizationEdge[] = [];

    await this.buildGraphRecursively(centerCIId, centerCI.tenant, maxDepth, 0, visitedNodes, nodes, edges, filters);

    const graph: ICMDBVisualizationGraph = {
      nodes,
      edges,
      center_node_id: centerCIId,
      depth_level: maxDepth,
      total_nodes: nodes.length,
      total_edges: edges.length,
      layout_type: layoutSettings?.layout_type || 'force',
      clustering_enabled: layoutSettings?.cluster_by ? true : false,
      filters: {
        node_types: filters?.ci_types,
        statuses: filters?.statuses,
        criticalities: filters?.criticalities,
        environments: filters?.environments,
        relationship_types: filters?.relationship_types
      }
    };

    if (layoutSettings) {
      await this.applyLayout(graph, layoutSettings);
    }

    return graph;
  }

  private async buildGraphRecursively(
    currentCIId: string,
    tenant: string,
    maxDepth: number,
    currentDepth: number,
    visitedNodes: Set<string>,
    nodes: ICMDBVisualizationNode[],
    edges: ICMDBVisualizationEdge[],
    filters?: ICMDBFilter
  ): Promise<void> {
    if (currentDepth > maxDepth || visitedNodes.has(currentCIId)) {
      return;
    }

    visitedNodes.add(currentCIId);

    const ci = await this.cmdbService.getConfigurationItem(currentCIId);
    if (!ci) return;

    if (this.passesNodeFilters(ci, filters)) {
      const node = await this.convertCIToVisualizationNode(ci);
      node.size = this.calculateNodeSize(node, currentDepth);
      nodes.push(node);
    }

    const relationships = await knex('ci_relationships')
      .where('tenant', tenant)
      .where(function() {
        this.where('source_ci_id', currentCIId)
            .orWhere('target_ci_id', currentCIId);
      })
      .where('status', 'active');

    for (const rel of relationships) {
      const relatedCIId = rel.source_ci_id === currentCIId ? rel.target_ci_id : rel.source_ci_id;
      
      if (this.passesEdgeFilters(rel, filters)) {
        const edge = this.convertRelationshipToVisualizationEdge(rel);
        edges.push(edge);
        
        await this.buildGraphRecursively(
          relatedCIId, 
          tenant, 
          maxDepth, 
          currentDepth + 1, 
          visitedNodes, 
          nodes, 
          edges, 
          filters
        );
      }
    }
  }

  private async convertCIToVisualizationNode(ci: IConfigurationItem): Promise<ICMDBVisualizationNode> {
    const relationshipCount = await this.cmdbService.getRelationshipCount(ci.ci_id);
    
    return {
      id: ci.ci_id,
      label: ci.ci_name,
      type: ci.ci_type,
      category: this.inferCategoryFromType(ci.ci_type),
      status: ci.ci_status,
      criticality: ci.business_criticality,
      environment: ci.environment,
      color: this.getNodeColor(ci),
      icon: this.getNodeIcon(ci.ci_type),
      description: ci.description,
      owner: ci.owner,
      last_updated: ci.updated_date || ci.created_date,
      size: Math.max(20, Math.min(60, relationshipCount * 5))
    };
  }

  private convertRelationshipToVisualizationEdge(rel: ICIRelationship): ICMDBVisualizationEdge {
    return {
      id: rel.relationship_id,
      source: rel.source_ci_id,
      target: rel.target_ci_id,
      relationship_type: rel.relationship_type,
      strength: rel.strength,
      criticality: rel.criticality,
      is_bidirectional: rel.is_bidirectional,
      color: this.getEdgeColor(rel),
      width: this.getEdgeWidth(rel),
      style: this.getEdgeStyle(rel)
    };
  }

  private calculateNodeSize(node: ICMDBVisualizationNode, depth: number): number {
    let baseSize = 40;
    
    if (depth === 0) baseSize = 60; // Center node
    else if (depth === 1) baseSize = 50; // Direct connections
    else baseSize = Math.max(20, 40 - (depth * 5)); // Decreasing size with depth
    
    switch (node.criticality) {
      case 'very_high': return baseSize * 1.3;
      case 'high': return baseSize * 1.2;
      case 'medium': return baseSize;
      case 'low': return baseSize * 0.9;
      case 'very_low': return baseSize * 0.8;
      default: return baseSize;
    }
  }

  private getNodeColor(ci: IConfigurationItem): string {
    const statusColors = {
      live: '#4CAF50',
      planned: '#2196F3',
      under_development: '#FF9800',
      withdrawn: '#F44336',
      disposed: '#9E9E9E'
    };
    
    return statusColors[ci.ci_status as keyof typeof statusColors] || '#607D8B';
  }

  private getNodeIcon(ciType: string): string {
    const typeIcons = {
      server: 'server',
      database: 'database',
      application: 'application',
      network: 'network',
      service: 'service',
      virtual_machine: 'vm',
      storage: 'storage',
      security: 'shield'
    };
    
    return typeIcons[ciType as keyof typeof typeIcons] || 'default';
  }

  private getEdgeColor(rel: ICIRelationship): string {
    const criticalityColors = {
      critical: '#F44336',
      important: '#FF9800',
      normal: '#4CAF50',
      low: '#9E9E9E'
    };
    
    return criticalityColors[rel.criticality] || '#607D8B';
  }

  private getEdgeWidth(rel: ICIRelationship): number {
    const strengthWidths = {
      strong: 4,
      medium: 2,
      weak: 1
    };
    
    return strengthWidths[rel.strength] || 2;
  }

  private getEdgeStyle(rel: ICIRelationship): 'solid' | 'dashed' | 'dotted' {
    if (rel.validation_status === 'pending') return 'dashed';
    if (rel.validation_status === 'suspected') return 'dotted';
    return 'solid';
  }

  async findDependencyPaths(
    sourceCIId: string,
    targetCIId: string,
    maxDepth: number = 5
  ): Promise<IDependencyPath[]> {
    const paths: IDependencyPath[] = [];
    const visited = new Set<string>();
    
    await this.findPathsRecursively(
      sourceCIId,
      targetCIId,
      [],
      [],
      visited,
      paths,
      maxDepth
    );
    
    for (const path of paths) {
      path.risk_level = this.calculatePathRisk(path);
      path.bottleneck_nodes = await this.identifyBottlenecks(path);
      path.confidence_score = this.calculatePathConfidence(path);
    }
    
    return paths.sort((a, b) => a.total_hops - b.total_hops);
  }

  private async findPathsRecursively(
    currentCIId: string,
    targetCIId: string,
    currentPath: { ci_id: string; ci_name: string; ci_type: string; position_in_path: number }[],
    currentRelationships: { relationship_id: string; relationship_type: string; strength: string; criticality: string }[],
    visited: Set<string>,
    paths: IDependencyPath[],
    maxDepth: number
  ): Promise<void> {
    if (currentPath.length >= maxDepth || visited.has(currentCIId)) {
      return;
    }
    
    if (currentCIId === targetCIId && currentPath.length > 0) {
      const ci = await this.cmdbService.getConfigurationItem(currentCIId);
      if (ci) {
        currentPath.push({
          ci_id: currentCIId,
          ci_name: ci.ci_name,
          ci_type: ci.ci_type,
          position_in_path: currentPath.length
        });
        
        paths.push({
          path_id: uuidv4(),
          source_ci_id: currentPath[0].ci_id,
          target_ci_id: currentCIId,
          path_nodes: [...currentPath],
          path_relationships: [...currentRelationships],
          total_hops: currentPath.length - 1,
          risk_level: 'medium',
          bottleneck_nodes: [],
          discovered_date: new Date(),
          confidence_score: 0
        });
        
        currentPath.pop();
      }
      return;
    }
    
    visited.add(currentCIId);
    const ci = await this.cmdbService.getConfigurationItem(currentCIId);
    if (!ci) {
      visited.delete(currentCIId);
      return;
    }
    
    currentPath.push({
      ci_id: currentCIId,
      ci_name: ci.ci_name,
      ci_type: ci.ci_type,
      position_in_path: currentPath.length
    });
    
    const relationships = await knex('ci_relationships')
      .where('source_ci_id', currentCIId)
      .where('status', 'active')
      .orderBy('criticality', 'desc');
    
    for (const rel of relationships) {
      currentRelationships.push({
        relationship_id: rel.relationship_id,
        relationship_type: rel.relationship_type,
        strength: rel.strength,
        criticality: rel.criticality
      });
      
      await this.findPathsRecursively(
        rel.target_ci_id,
        targetCIId,
        currentPath,
        currentRelationships,
        visited,
        paths,
        maxDepth
      );
      
      currentRelationships.pop();
    }
    
    currentPath.pop();
    visited.delete(currentCIId);
  }

  private calculatePathRisk(path: IDependencyPath): 'critical' | 'high' | 'medium' | 'low' {
    let riskScore = 0;
    
    for (const rel of path.path_relationships) {
      switch (rel.criticality) {
        case 'critical': riskScore += 4; break;
        case 'important': riskScore += 3; break;
        case 'normal': riskScore += 2; break;
        case 'low': riskScore += 1; break;
      }
      
      if (rel.strength === 'weak') riskScore += 1;
    }
    
    riskScore += path.total_hops; // Longer paths are riskier
    
    if (riskScore >= 15) return 'critical';
    if (riskScore >= 10) return 'high';
    if (riskScore >= 5) return 'medium';
    return 'low';
  }

  private async identifyBottlenecks(path: IDependencyPath): Promise<string[]> {
    const bottlenecks: string[] = [];
    
    for (const node of path.path_nodes.slice(1, -1)) { // Exclude source and target
      const relationshipCount = await this.cmdbService.getRelationshipCount(node.ci_id);
      
      if (relationshipCount <= 2) {
        bottlenecks.push(node.ci_id);
      }
    }
    
    return bottlenecks;
  }

  private calculatePathConfidence(path: IDependencyPath): number {
    let confidence = 90; // Base confidence
    
    confidence -= path.total_hops * 2;
    
    for (const rel of path.path_relationships) {
      if (rel.strength === 'weak') confidence -= 5;
      if (rel.criticality === 'low') confidence -= 3;
    }
    
    if (path.bottleneck_nodes.length > 0) {
      confidence -= path.bottleneck_nodes.length * 10;
    }
    
    return Math.max(0, Math.min(100, confidence));
  }

  async generateImpactVisualization(
    centerCIId: string,
    impactDirection: 'upstream' | 'downstream' | 'both' = 'downstream',
    maxDepth: number = 3
  ): Promise<IImpactVisualization> {
    const centerCI = await this.cmdbService.getConfigurationItem(centerCIId);
    if (!centerCI) {
      throw new Error(`Configuration Item ${centerCIId} not found`);
    }

    const impactLevels: any[] = [];
    const impactFlows: any[] = [];
    const heatMap: any[] = [];
    
    const level0 = {
      level: 0,
      nodes: [await this.convertCIToVisualizationNode(centerCI)],
      impact_severity: 'critical' as const
    };
    impactLevels.push(level0);
    
    for (let depth = 1; depth <= maxDepth; depth++) {
      const levelNodes = await this.getImpactedCIsAtDepth(centerCIId, depth, impactDirection, centerCI.tenant);
      
      if (levelNodes.length > 0) {
        const avgSeverity = this.calculateAverageImpactSeverity(levelNodes, depth);
        impactLevels.push({
          level: depth,
          nodes: levelNodes,
          impact_severity: avgSeverity
        });
        
        for (const node of levelNodes) {
          const heatScore = this.calculateHeatScore(node, depth);
          heatMap.push({
            ci_id: node.id,
            heat_score: heatScore,
            color_intensity: heatScore / 100
          });
          
          if (depth > 1) {
            impactFlows.push({
              from_ci_id: centerCIId,
              to_ci_id: node.id,
              impact_type: depth === 1 ? 'cascading' as const : 'dependent' as const,
              severity: this.calculateFlowSeverity(node, depth),
              animated: heatScore > 70
            });
          }
        }
      }
    }

    return {
      analysis_id: uuidv4(),
      center_ci_id: centerCIId,
      impact_direction: impactDirection,
      impact_levels: impactLevels,
      impact_flows: impactFlows,
      heat_map: heatMap
    };
  }

  private async getImpactedCIsAtDepth(
    centerCIId: string,
    depth: number,
    direction: 'upstream' | 'downstream' | 'both',
    tenant: string
  ): Promise<ICMDBVisualizationNode[]> {
    const nodes: ICMDBVisualizationNode[] = [];
    const visited = new Set<string>();
    
    await this.collectNodesAtDepth(centerCIId, depth, 0, direction, tenant, visited, nodes);
    
    return nodes;
  }

  private async collectNodesAtDepth(
    currentCIId: string,
    targetDepth: number,
    currentDepth: number,
    direction: 'upstream' | 'downstream' | 'both',
    tenant: string,
    visited: Set<string>,
    nodes: ICMDBVisualizationNode[]
  ): Promise<void> {
    if (currentDepth > targetDepth || visited.has(currentCIId)) {
      return;
    }
    
    visited.add(currentCIId);
    
    if (currentDepth === targetDepth && currentCIId !== nodes[0]?.id) {
      const ci = await this.cmdbService.getConfigurationItem(currentCIId);
      if (ci) {
        nodes.push(await this.convertCIToVisualizationNode(ci));
      }
    }
    
    if (currentDepth < targetDepth) {
      let relationshipsQuery = knex('ci_relationships')
        .where('tenant', tenant)
        .where('status', 'active');
      
      if (direction === 'downstream' || direction === 'both') {
        relationshipsQuery = relationshipsQuery.where('source_ci_id', currentCIId);
      }
      if (direction === 'upstream' || direction === 'both') {
        relationshipsQuery = relationshipsQuery.orWhere('target_ci_id', currentCIId);
      }
      
      const relationships = await relationshipsQuery;
      
      for (const rel of relationships) {
        const nextCIId = rel.source_ci_id === currentCIId ? rel.target_ci_id : rel.source_ci_id;
        await this.collectNodesAtDepth(nextCIId, targetDepth, currentDepth + 1, direction, tenant, visited, nodes);
      }
    }
  }

  private calculateAverageImpactSeverity(nodes: ICMDBVisualizationNode[], depth: number): 'critical' | 'high' | 'medium' | 'low' {
    let totalScore = 0;
    
    for (const node of nodes) {
      switch (node.criticality) {
        case 'very_high': totalScore += 5; break;
        case 'high': totalScore += 4; break;
        case 'medium': totalScore += 3; break;
        case 'low': totalScore += 2; break;
        case 'very_low': totalScore += 1; break;
      }
    }
    
    const avgScore = totalScore / nodes.length;
    const depthAdjustedScore = avgScore - (depth * 0.5);
    
    if (depthAdjustedScore >= 4.5) return 'critical';
    if (depthAdjustedScore >= 3.5) return 'high';
    if (depthAdjustedScore >= 2.5) return 'medium';
    return 'low';
  }

  private calculateHeatScore(node: ICMDBVisualizationNode, depth: number): number {
    let score = 50; // Base score
    
    switch (node.criticality) {
      case 'very_high': score += 40; break;
      case 'high': score += 30; break;
      case 'medium': score += 20; break;
      case 'low': score += 10; break;
      case 'very_low': score += 0; break;
    }
    
    if (node.environment === 'production') score += 20;
    if (node.status === 'live') score += 10;
    
    score -= (depth - 1) * 15;
    
    return Math.max(0, Math.min(100, score));
  }

  private calculateFlowSeverity(node: ICMDBVisualizationNode, depth: number): 'critical' | 'high' | 'medium' | 'low' {
    const heatScore = this.calculateHeatScore(node, depth);
    
    if (heatScore >= 80) return 'critical';
    if (heatScore >= 60) return 'high';
    if (heatScore >= 40) return 'medium';
    return 'low';
  }

  async searchCMDB(
    query: string,
    tenant: string,
    filters?: ICMDBFilter,
    limit: number = 50
  ): Promise<ICMDBSearchResult[]> {
    let searchQuery = knex('configuration_items')
      .where('tenant', tenant)
      .limit(limit);
    
    if (query.trim()) {
      searchQuery = searchQuery.where(function() {
        this.where('ci_name', 'ilike', `%${query}%`)
            .orWhere('ci_number', 'ilike', `%${query}%`)
            .orWhere('description', 'ilike', `%${query}%`)
            .orWhereRaw("technical_attributes::text ilike ?", [`%${query}%`]);
      });
    }
    
    if (filters) {
      searchQuery = this.applyFiltersToQuery(searchQuery, filters);
    }
    
    const results = await searchQuery;
    const searchResults: ICMDBSearchResult[] = [];
    
    for (const ci of results) {
      const relationshipCount = await this.cmdbService.getRelationshipCount(ci.ci_id);
      const matchScore = this.calculateMatchScore(ci, query);
      const matchedFields = this.identifyMatchedFields(ci, query);
      
      searchResults.push({
        ci_id: ci.ci_id,
        ci_name: ci.ci_name,
        ci_type: ci.ci_type,
        ci_number: ci.ci_number,
        description: ci.description,
        match_score: matchScore,
        matched_fields: matchedFields,
        relationship_count: relationshipCount,
        parent_cis: [],
        child_cis: [],
        status: ci.ci_status,
        environment: ci.environment,
        criticality: ci.business_criticality,
        owner: ci.owner,
        last_updated: ci.updated_date || ci.created_date
      });
    }
    
    return searchResults.sort((a, b) => b.match_score - a.match_score);
  }

  private calculateMatchScore(ci: IConfigurationItem, query: string): number {
    let score = 0;
    const lowerQuery = query.toLowerCase();
    
    if (ci.ci_name.toLowerCase().includes(lowerQuery)) {
      score += ci.ci_name.toLowerCase() === lowerQuery ? 100 : 80;
    }
    
    if (ci.ci_number.toLowerCase().includes(lowerQuery)) {
      score += 90;
    }
    
    if (ci.description?.toLowerCase().includes(lowerQuery)) {
      score += 60;
    }
    
    if (JSON.stringify(ci.technical_attributes).toLowerCase().includes(lowerQuery)) {
      score += 40;
    }
    
    return Math.min(100, score);
  }

  private identifyMatchedFields(ci: IConfigurationItem, query: string): Array<{ field_name: string; matched_text: string; highlight_positions: number[] }> {
    const matches = [];
    const lowerQuery = query.toLowerCase();
    
    if (ci.ci_name.toLowerCase().includes(lowerQuery)) {
      const startPos = ci.ci_name.toLowerCase().indexOf(lowerQuery);
      matches.push({
        field_name: 'ci_name',
        matched_text: ci.ci_name,
        highlight_positions: [startPos, startPos + query.length]
      });
    }
    
    if (ci.description?.toLowerCase().includes(lowerQuery)) {
      const startPos = ci.description.toLowerCase().indexOf(lowerQuery);
      matches.push({
        field_name: 'description',
        matched_text: ci.description,
        highlight_positions: [startPos, startPos + query.length]
      });
    }
    
    return matches;
  }

  private async applyLayout(graph: ICMDBVisualizationGraph, layoutSettings: ICMDBLayoutSettings): Promise<void> {
    switch (layoutSettings.layout_type) {
      case 'force':
        this.applyForceDirectedLayout(graph, layoutSettings);
        break;
      case 'hierarchical':
        this.applyHierarchicalLayout(graph, layoutSettings);
        break;
      case 'circular':
        this.applyCircularLayout(graph, layoutSettings);
        break;
      case 'grid':
        this.applyGridLayout(graph, layoutSettings);
        break;
    }
  }

  private applyForceDirectedLayout(graph: ICMDBVisualizationGraph, settings: ICMDBLayoutSettings): void {
    const centerX = 400;
    const centerY = 300;
    
    if (graph.center_node_id) {
      const centerNode = graph.nodes.find(n => n.id === graph.center_node_id);
      if (centerNode) {
        centerNode.x = centerX;
        centerNode.y = centerY;
      }
    }
    
    const radius = settings.edge_length || 150;
    let angle = 0;
    const angleStep = (2 * Math.PI) / Math.max(1, graph.nodes.length - 1);
    
    for (const node of graph.nodes) {
      if (node.id !== graph.center_node_id) {
        node.x = centerX + Math.cos(angle) * radius;
        node.y = centerY + Math.sin(angle) * radius;
        angle += angleStep;
      }
    }
  }

  private applyHierarchicalLayout(graph: ICMDBVisualizationGraph, settings: ICMDBLayoutSettings): void {
    const levels = new Map<string, number>();
    const visited = new Set<string>();
    
    if (graph.center_node_id) {
      this.assignLevels(graph.center_node_id, 0, graph, levels, visited);
    }
    
    const levelGroups = new Map<number, string[]>();
    for (const [nodeId, level] of levels.entries()) {
      if (!levelGroups.has(level)) {
        levelGroups.set(level, []);
      }
      levelGroups.get(level)!.push(nodeId);
    }
    
    const levelSeparation = settings.level_separation || 100;
    const nodeSeparation = settings.node_separation || 80;
    
    for (const [level, nodeIds] of levelGroups.entries()) {
      const y = level * levelSeparation;
      const totalWidth = (nodeIds.length - 1) * nodeSeparation;
      const startX = -totalWidth / 2;
      
      nodeIds.forEach((nodeId, index) => {
        const node = graph.nodes.find(n => n.id === nodeId);
        if (node) {
          node.x = startX + (index * nodeSeparation);
          node.y = y;
        }
      });
    }
  }

  private assignLevels(
    nodeId: string,
    level: number,
    graph: ICMDBVisualizationGraph,
    levels: Map<string, number>,
    visited: Set<string>
  ): void {
    if (visited.has(nodeId)) return;
    
    visited.add(nodeId);
    levels.set(nodeId, level);
    
    const connectedEdges = graph.edges.filter(e => e.source === nodeId || e.target === nodeId);
    for (const edge of connectedEdges) {
      const connectedNodeId = edge.source === nodeId ? edge.target : edge.source;
      if (!levels.has(connectedNodeId) || levels.get(connectedNodeId)! > level + 1) {
        this.assignLevels(connectedNodeId, level + 1, graph, levels, visited);
      }
    }
  }

  private applyCircularLayout(graph: ICMDBVisualizationGraph, settings: ICMDBLayoutSettings): void {
    const centerX = 400;
    const centerY = 300;
    const radius = settings.edge_length || 200;
    
    const angleStep = (2 * Math.PI) / graph.nodes.length;
    
    graph.nodes.forEach((node, index) => {
      const angle = index * angleStep;
      node.x = centerX + Math.cos(angle) * radius;
      node.y = centerY + Math.sin(angle) * radius;
    });
  }

  private applyGridLayout(graph: ICMDBVisualizationGraph, settings: ICMDBLayoutSettings): void {
    const cols = Math.ceil(Math.sqrt(graph.nodes.length));
    const spacing = settings.node_separation || 100;
    
    graph.nodes.forEach((node, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      
      node.x = col * spacing;
      node.y = row * spacing;
    });
  }

  private passesNodeFilters(ci: IConfigurationItem, filters?: ICMDBFilter): boolean {
    if (!filters) return true;
    
    if (filters.ci_types && !filters.ci_types.includes(ci.ci_type)) return false;
    if (filters.statuses && !filters.statuses.includes(ci.ci_status)) return false;
    if (filters.environments && !filters.environments.includes(ci.environment)) return false;
    if (filters.criticalities && !filters.criticalities.includes(ci.business_criticality)) return false;
    if (filters.owners && !filters.owners.includes(ci.owner)) return false;
    if (filters.locations && ci.location && !filters.locations.includes(ci.location)) return false;
    
    return true;
  }

  private passesEdgeFilters(rel: ICIRelationship, filters?: ICMDBFilter): boolean {
    if (!filters) return true;
    
    if (filters.relationship_types && !filters.relationship_types.includes(rel.relationship_type)) return false;
    if (filters.relationship_strengths && !filters.relationship_strengths.includes(rel.strength)) return false;
    if (filters.relationship_criticalities && !filters.relationship_criticalities.includes(rel.criticality)) return false;
    
    return true;
  }

  private applyFiltersToQuery(query: any, filters: ICMDBFilter): any {
    if (filters.ci_types) {
      query = query.whereIn('ci_type', filters.ci_types);
    }
    if (filters.statuses) {
      query = query.whereIn('ci_status', filters.statuses);
    }
    if (filters.environments) {
      query = query.whereIn('environment', filters.environments);
    }
    if (filters.criticalities) {
      query = query.whereIn('business_criticality', filters.criticalities);
    }
    if (filters.owners) {
      query = query.whereIn('owner', filters.owners);
    }
    if (filters.created_date_range) {
      query = query.whereBetween('created_date', [filters.created_date_range.start, filters.created_date_range.end]);
    }
    if (filters.updated_date_range) {
      query = query.whereBetween('updated_date', [filters.updated_date_range.start, filters.updated_date_range.end]);
    }
    
    return query;
  }

  private inferCategoryFromType(ciType: string): 'hardware' | 'software' | 'service' | 'documentation' | 'location' | 'person' {
    const typeToCategory: { [key: string]: 'hardware' | 'software' | 'service' | 'documentation' | 'location' | 'person' } = {
      server: 'hardware',
      workstation: 'hardware',
      laptop: 'hardware',
      router: 'hardware',
      switch: 'hardware',
      printer: 'hardware',
      application: 'software',
      database: 'software',
      operating_system: 'software',
      middleware: 'software',
      service: 'service',
      web_service: 'service',
      api: 'service',
      documentation: 'documentation',
      manual: 'documentation',
      procedure: 'documentation',
      datacenter: 'location',
      building: 'location',
      room: 'location',
      person: 'person',
      team: 'person'
    };
    
    return typeToCategory[ciType] || 'hardware';
  }
}