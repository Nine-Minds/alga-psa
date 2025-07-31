// Diagnostic script to understand the debugger issues
const WebSocket = require('ws');

async function diagnose() {
  console.log('Starting debugger diagnostics...\n');
  
  // Connect to the inspector
  const ws = new WebSocket('ws://127.0.0.1:9229/json/list');
  
  ws.on('error', (err) => {
    console.error('Failed to connect to inspector:', err.message);
    console.log('\nMake sure a Node.js process is running with --inspect flag');
    process.exit(1);
  });
  
  ws.on('message', async (data) => {
    const targets = JSON.parse(data.toString());
    console.log('Found targets:', targets.length);
    
    if (targets.length === 0) {
      console.log('No debug targets found');
      process.exit(1);
    }
    
    const target = targets[0];
    console.log('\nConnecting to:', target.url);
    
    // Connect to the actual debugger
    const debugWs = new WebSocket(target.webSocketDebuggerUrl);
    let messageId = 1;
    
    const sendCommand = (method, params = {}) => {
      const id = messageId++;
      const message = JSON.stringify({ id, method, params });
      console.log(`\nSending: ${method}`);
      debugWs.send(message);
      return id;
    };
    
    debugWs.on('open', () => {
      console.log('Connected to debugger');
      
      // Try to enable Runtime and Debugger domains
      sendCommand('Runtime.enable');
      sendCommand('Debugger.enable');
      
      // After a delay, try to get scripts
      setTimeout(() => {
        sendCommand('Runtime.evaluate', {
          expression: 'process.mainModule ? process.mainModule.filename : "no main module"',
          returnByValue: true
        });
      }, 500);
    });
    
    debugWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      
      if (msg.method) {
        // This is an event
        console.log(`\nEvent: ${msg.method}`);
        if (msg.method === 'Debugger.scriptParsed') {
          console.log('Script parsed:', {
            id: msg.params.scriptId,
            url: msg.params.url || '<empty>',
            length: msg.params.length
          });
        }
      } else if (msg.result) {
        // This is a response
        console.log('Response received:', msg.result);
      } else if (msg.error) {
        // This is an error
        console.error('Error:', msg.error);
      }
    });
    
    debugWs.on('error', (err) => {
      console.error('Debugger error:', err);
    });
    
    // Close after 3 seconds
    setTimeout(() => {
      console.log('\nClosing connection...');
      debugWs.close();
      ws.close();
      process.exit(0);
    }, 3000);
  });
}

diagnose();