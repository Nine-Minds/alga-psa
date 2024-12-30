import { Page } from 'puppeteer';
import { Tool } from './Tool';
import * as tools from './index';

class ToolManager {
  private toolMap: Map<string, Tool>;

  constructor() {
    this.toolMap = new Map();
    // Register all tools
    Object.values(tools).forEach((tool) => {
      this.toolMap.set(tool.name, tool);
    });
  }

  public async executeTool(toolName: string, page: Page, args: any): Promise<any> {
    const tool = this.toolMap.get(toolName);
    if (!tool) {
      throw new Error(`Tool "${toolName}" not found`);
    }
    return await tool.execute(page, args);
  }
}

export const toolManager = new ToolManager();
