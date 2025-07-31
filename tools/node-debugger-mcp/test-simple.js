const { StdioClientTransport, McpClient } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function testDebugger() {
  const client = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
  });

  const mcpClient = new McpClient({
    name: 'test-client',
    version: '1.0.0',
  });

  await mcpClient.connect(client);
  
  console.log('Connected to debugger MCP server');
  
  // List available tools
  const tools = await mcpClient.listTools();
  console.log('Available tools:', tools.tools.map(t => t.name));
  
  // List processes
  console.log('\nListing Node.js processes...');
  const result = await mcpClient.callTool('listProcesses', {});
  console.log('Process list result:', JSON.parse(result.content[0].text));
  
  await mcpClient.close();
}

testDebugger().catch(console.error);