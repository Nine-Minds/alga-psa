// CMDB Visualization and Dependency Mapping Interfaces

export interface ICMDBVisualizationNode {
  id: string;
  label: string;
  type: string;
  category: 'hardware' | 'software' | 'service' | 'documentation' | 'location' | 'person';
  status: 'planned' | 'ordered' | 'received' | 'under_development' | 'build_complete' | 'live' | 'withdrawn' | 'disposed';
  criticality: 'very_high' | 'high' | 'medium' | 'low' | 'very_low';
  environment: 'production' | 'staging' | 'testing' | 'development' | 'disaster_recovery';
  
  // Visual properties
  x?: number;
  y?: number;
  color?: string;
  size?: number;
  icon?: string;
  
  // Metadata
  description?: string;
  owner?: string;
  last_updated?: Date;
  
  // State for visualization
  highlighted?: boolean;
  selected?: boolean;
  collapsed?: boolean;
}

export interface ICMDBVisualizationEdge {
  id: string;
  source: string;
  target: string;
  relationship_type: 'depends_on' | 'part_of' | 'connected_to' | 'installed_on' | 'uses' | 'provides' | 'manages' | 'backed_up_by' | 'clustered_with';
  
  // Relationship properties
  strength: 'strong' | 'medium' | 'weak';
  criticality: 'critical' | 'important' | 'normal' | 'low';
  is_bidirectional: boolean;
  
  // Visual properties
  color?: string;
  width?: number;
  style?: 'solid' | 'dashed' | 'dotted';
  
  // State
  highlighted?: boolean;
  animated?: boolean;
}

export interface ICMDBVisualizationGraph {
  nodes: ICMDBVisualizationNode[];
  edges: ICMDBVisualizationEdge[];
  
  // Graph metadata
  center_node_id?: string;
  depth_level: number;
  total_nodes: number;
  total_edges: number;
  
  // Layout settings
  layout_type: 'force' | 'hierarchical' | 'circular' | 'grid';
  clustering_enabled: boolean;
  
  // Filters applied
  filters: {
    node_types?: string[];
    statuses?: string[];
    criticalities?: string[];
    environments?: string[];
    relationship_types?: string[];
  };
}

export interface IDependencyPath {
  path_id: string;
  source_ci_id: string;
  target_ci_id: string;
  path_nodes: {
    ci_id: string;
    ci_name: string;
    ci_type: string;
    position_in_path: number;
  }[];
  path_relationships: {
    relationship_id: string;
    relationship_type: string;
    strength: string;
    criticality: string;
  }[];
  
  // Path analysis
  total_hops: number;
  risk_level: 'critical' | 'high' | 'medium' | 'low';
  bottleneck_nodes: string[]; // CIs that are single points of failure in this path
  
  // Path metadata
  discovered_date: Date;
  confidence_score: number; // 0-100%
}

export interface IImpactVisualization {
  analysis_id: string;
  center_ci_id: string;
  impact_direction: 'upstream' | 'downstream' | 'both';
  
  // Impact levels as concentric circles
  impact_levels: {
    level: number; // 0 = center, 1 = direct impact, 2+ = indirect
    nodes: ICMDBVisualizationNode[];
    impact_severity: 'critical' | 'high' | 'medium' | 'low';
  }[];
  
  // Impact flow visualization
  impact_flows: {
    from_ci_id: string;
    to_ci_id: string;
    impact_type: 'cascading' | 'dependent' | 'related';
    severity: 'critical' | 'high' | 'medium' | 'low';
    animated: boolean;
  }[];
  
  // Heat map data
  heat_map: {
    ci_id: string;
    heat_score: number; // 0-100, based on impact severity and frequency
    color_intensity: number; // 0-1 for visual representation
  }[];
}

export interface ICMDBLayoutSettings {
  layout_id: string;
  layout_name: string;
  layout_type: 'force' | 'hierarchical' | 'circular' | 'grid' | 'custom';
  
  // Layout parameters
  node_spacing: number;
  edge_length: number;
  gravity_strength: number;
  repulsion_strength: number;
  
  // Hierarchical specific
  level_separation?: number;
  node_separation?: number;
  tree_direction?: 'top-down' | 'bottom-up' | 'left-right' | 'right-left';
  
  // Force-directed specific
  simulation_alpha?: number;
  center_force?: number;
  collision_radius?: number;
  
  // Clustering
  cluster_by?: 'type' | 'environment' | 'owner' | 'location' | 'criticality';
  cluster_strength?: number;
  
  // Visual settings
  node_size_metric: 'fixed' | 'relationship_count' | 'criticality' | 'impact_score';
  edge_thickness_metric: 'fixed' | 'strength' | 'criticality' | 'usage_frequency';
  color_scheme: 'default' | 'status' | 'type' | 'criticality' | 'environment' | 'custom';
  
  // Animation
  enable_animations: boolean;
  transition_duration: number;
  
  // User preferences
  auto_zoom: boolean;
  show_labels: boolean;
  show_node_details_on_hover: boolean;
  highlight_paths_on_select: boolean;
}

export interface ICMDBFilter {
  filter_id: string;
  filter_name: string;
  description?: string;
  
  // Filter criteria
  ci_types?: string[];
  statuses?: string[];
  environments?: string[];
  criticalities?: string[];
  owners?: string[];
  locations?: string[];
  
  // Date ranges
  created_date_range?: {
    start: Date;
    end: Date;
  };
  updated_date_range?: {
    start: Date;
    end: Date;
  };
  
  // Relationship filters
  relationship_types?: string[];
  relationship_strengths?: string[];
  relationship_criticalities?: string[];
  
  // Advanced filters
  has_relationships: boolean;
  is_orphaned?: boolean;
  in_circular_dependency?: boolean;
  discovery_status?: string[];
  
  // Text search
  search_query?: string;
  search_fields?: string[]; // Fields to search in
  
  // Custom attributes filter
  custom_attribute_filters?: {
    [attribute_name: string]: any;
  };
}

export interface ICMDBDashboard {
  dashboard_id: string;
  dashboard_name: string;
  tenant: string;
  
  // Dashboard layout
  widgets: ICMDBWidget[];
  layout: {
    columns: number;
    rows: number;
    widget_positions: {
      widget_id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }[];
  };
  
  // Dashboard settings
  refresh_interval: number; // seconds
  auto_refresh: boolean;
  
  // Access control
  owner: string;
  shared_with: string[];
  is_public: boolean;
  
  // Metadata
  created_date: Date;
  created_by: string;
  updated_date?: Date;
  updated_by?: string;
}

export interface ICMDBWidget {
  widget_id: string;
  widget_type: 'graph' | 'metrics' | 'list' | 'chart' | 'heatmap' | 'timeline';
  title: string;
  
  // Widget configuration
  data_source: 'live' | 'cached' | 'historical';
  refresh_rate: number; // seconds, 0 for manual refresh
  
  // Graph widget specific
  graph_config?: {
    center_ci_id?: string;
    max_depth: number;
    layout_settings: ICMDBLayoutSettings;
    filters: ICMDBFilter;
  };
  
  // Metrics widget specific
  metrics_config?: {
    metric_types: ('total_cis' | 'by_type' | 'by_status' | 'relationships' | 'orphaned' | 'quality_score')[];
    time_period: 'last_hour' | 'last_day' | 'last_week' | 'last_month';
    comparison_enabled: boolean;
  };
  
  // List widget specific
  list_config?: {
    ci_types: string[];
    sort_by: string;
    sort_order: 'asc' | 'desc';
    page_size: number;
    columns: string[];
  };
  
  // Chart widget specific
  chart_config?: {
    chart_type: 'pie' | 'bar' | 'line' | 'area' | 'scatter';
    data_field: string;
    group_by: string;
    time_series: boolean;
  };
  
  // Styling
  background_color?: string;
  border_color?: string;
  text_color?: string;
  
  // State
  is_loading: boolean;
  last_updated: Date;
  error_message?: string;
}

export interface ICMDBSearchResult {
  ci_id: string;
  ci_name: string;
  ci_type: string;
  ci_number: string;
  description: string;
  
  // Match information
  match_score: number; // 0-100 relevance score
  matched_fields: {
    field_name: string;
    matched_text: string;
    highlight_positions: number[];
  }[];
  
  // Context
  relationship_count: number;
  parent_cis: string[];
  child_cis: string[];
  
  // Quick info
  status: string;
  environment: string;
  criticality: string;
  owner: string;
  last_updated: Date;
}

export interface ICMDBExportOptions {
  export_id: string;
  export_format: 'json' | 'xml' | 'csv' | 'excel' | 'pdf' | 'visio' | 'graphml';
  
  // Export scope
  include_nodes: boolean;
  include_relationships: boolean;
  include_attributes: boolean;
  include_audit_trail: boolean;
  
  // Filtering
  filters?: ICMDBFilter;
  node_ids?: string[]; // Specific nodes to export
  
  // Format specific options
  csv_options?: {
    delimiter: string;
    include_headers: boolean;
    flatten_attributes: boolean;
  };
  
  excel_options?: {
    separate_sheets: boolean;
    include_charts: boolean;
    include_pivot_tables: boolean;
  };
  
  pdf_options?: {
    include_diagrams: boolean;
    page_orientation: 'portrait' | 'landscape';
    include_summary: boolean;
  };
  
  visio_options?: {
    template: string;
    layout_type: string;
    include_labels: boolean;
  };
  
  // Export metadata
  requested_by: string;
  requested_date: Date;
  export_reason?: string;
  retention_days?: number;
}