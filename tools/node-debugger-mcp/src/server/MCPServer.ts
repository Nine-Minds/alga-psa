import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ProcessDiscovery } from '../utils/ProcessDiscovery.js';
import { ToolManager } from '../tools/ToolManager.js';
import { initializeLogger, type Logger } from '../utils/logger.js';
import { getActiveSession } from '../utils/globalSession.js';

export class MCPServer {
  private server: McpServer;
  private processDiscovery: ProcessDiscovery;
  private toolManager: ToolManager;
  private logger: Logger;

  constructor(config: any) {
    this.logger = initializeLogger(config.logging);
    this.processDiscovery = new ProcessDiscovery();
    this.toolManager = new ToolManager();

    // Create McpServer instance
    this.server = new McpServer({
      name: config.name,
      version: config.version,
    });

    this.registerTools();
    
    this.logger.info('MCP Debugger Server initialized', {
      name: config.name,
      version: config.version,
    });
  }

  private registerTools() {
    // Register all tools from ToolManager
    const toolDefinitions = this.toolManager.getToolDefinitions();
    for (const toolDef of toolDefinitions) {
      this.registerToolFromDefinition(toolDef);
    }
    
    const toolNames = toolDefinitions.map(t => t.name).join(', ');
    this.logger.info(`Registered ${toolDefinitions.length} debugging tools: ${toolNames}`);
  }

  async start(): Promise<void> {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      
      this.logger.info('MCP Debugger Server started successfully');
      this.logger.info('Ready to accept MCP connections');
      
    } catch (error) {
      this.logger.error('Failed to start Simple MCP server', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      await this.server.close();
      
      this.logger.info('MCP Debugger Server stopped');
    } catch (error) {
      this.logger.error('Error during server shutdown', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Register a tool from ToolManager definition, converting schema to Zod
   */
  private registerToolFromDefinition(toolDef: any): void {
    // Convert the custom schema format to Zod schema
    const zodSchema = this.convertToZodSchema(toolDef.inputSchema);
    
    // Store references to avoid 'this' context issues
    const toolManager = this.toolManager;
    
    this.server.registerTool(
      toolDef.name,
      {
        title: toolDef.name,
        description: toolDef.description,
        inputSchema: zodSchema,
      },
      async (args) => {
        try {
          let debugSession = null;
          
          // Tools that don't need a session
          if (toolDef.name === 'listProcesses' || toolDef.name === 'attachDebugger') {
            // These tools manage their own sessions or don't need one
            debugSession = null;
          } else {
            // Other tools need an existing session
            debugSession = getActiveSession();
            if (!debugSession) {
              throw new Error('No active debug session. Use attachDebugger first.');
            }
          }
          
          // Execute the tool through ToolManager
          const result = await toolManager.executeTool(
            { name: toolDef.name, arguments: args },
            debugSession,
            {} as any // MCP session placeholder
          );
          
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorResult = {
            success: false,
            error: errorMessage,
            errorCode: 'EXECUTION_ERROR',
            toolName: toolDef.name,
            timestamp: new Date().toISOString(),
          };
          
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(errorResult, null, 2),
              },
            ],
          };
        }
      }
    );
  }
  
  /**
   * Convert custom schema format to Zod schema
   */
  private convertToZodSchema(schema: any): any {
    const zodShape: Record<string, any> = {};
    
    if (schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties) as [string, any][]) {
        let zodField;
        
        switch (prop.type) {
          case 'string':
            zodField = z.string();
            if (prop.minLength) zodField = zodField.min(prop.minLength);
            if (prop.maxLength) zodField = zodField.max(prop.maxLength);
            if (prop.pattern) zodField = zodField.regex(new RegExp(prop.pattern));
            if (prop.enum) zodField = z.enum(prop.enum);
            break;
            
          case 'number':
            zodField = z.number();
            if (prop.minimum !== undefined) zodField = zodField.min(prop.minimum);
            if (prop.maximum !== undefined) zodField = zodField.max(prop.maximum);
            if (prop.integer) zodField = zodField.int();
            break;
            
          case 'boolean':
            zodField = z.boolean();
            break;
            
          case 'array':
            zodField = z.array(z.any());
            break;
            
          case 'object':
            zodField = z.object({});
            break;
            
          default:
            zodField = z.any();
        }
        
        // Apply default
        if (prop.default !== undefined) {
          zodField = zodField.default(prop.default);
        }
        
        // Apply optional
        if (prop.optional || (schema.required && !schema.required.includes(key))) {
          zodField = zodField.optional();
        }
        
        // Apply description
        if (prop.description) {
          zodField = zodField.describe(prop.description);
        }
        
        zodShape[key] = zodField;
      }
    }
    
    return zodShape;
  }

  // Expose the underlying McpServer for HTTP transport
  getServer(): McpServer {
    return this.server;
  }
}