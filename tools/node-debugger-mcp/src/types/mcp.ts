// MCP (Model Context Protocol) specific types

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: MCPInputSchema;
}

export interface MCPInputSchema {
  type: 'object';
  properties: Record<string, MCPPropertySchema>;
  required?: string[];
}

export interface MCPPropertySchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: MCPPropertySchema;
  properties?: Record<string, MCPPropertySchema>;
  default?: any;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  optional?: boolean;
}

export interface MCPToolRequest {
  name: string;
  arguments: Record<string, any>;
}

export interface MCPToolResponse {
  content: MCPContent[];
  isError?: boolean;
  _meta?: Record<string, any>;
}

export interface MCPContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface MCPError {
  code: number;
  message: string;
  data?: any;
}

// Authentication and session types
export interface MCPAuthRequest {
  apiKey: string;
  clientId?: string;
  requestId?: string;
}

export interface MCPSession {
  id: string;
  clientId: string;
  apiKey: string;
  createdAt: Date;
  lastActivity: Date;
  isActive: boolean;
  metadata?: Record<string, any>;
}

// Rate limiting types
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetTime: Date;
  windowStart: Date;
}

export interface RateLimitRule {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (request: any) => string;
}