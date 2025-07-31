// Test application for debugging
const http = require('http');

// Global variables for testing
let requestCount = 0;
const users = [
  { id: 1, name: 'Alice', email: 'alice@example.com' },
  { id: 2, name: 'Bob', email: 'bob@example.com' },
  { id: 3, name: 'Charlie', email: 'charlie@example.com' }
];

// Function to test hot patching
function getUserById(id) {
  console.log(`Looking for user with id: ${id}`);
  return users.find(user => user.id === id);
}

// Function with breakpoint opportunities
function processRequest(req, res) {
  requestCount++;
  console.log(`Processing request #${requestCount}: ${req.method} ${req.url}`);
  
  if (req.url === '/users') {
    // List all users
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(users));
  } else if (req.url.startsWith('/user/')) {
    // Get specific user
    const userId = parseInt(req.url.split('/')[2]);
    const user = getUserById(userId);
    
    if (user) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(user));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('User not found');
    }
  } else if (req.url === '/debug') {
    // Debug endpoint to test evaluation
    const debugInfo = {
      requestCount,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      pid: process.pid
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(debugInfo, null, 2));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

// Create server
const server = http.createServer((req, res) => {
  try {
    processRequest(req, res);
  } catch (error) {
    console.error('Error processing request:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error');
  }
});

// Start server
const PORT = 3333;
server.listen(PORT, () => {
  console.log(`Test server running at http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('  GET /users - List all users');
  console.log('  GET /user/:id - Get specific user');
  console.log('  GET /debug - Get debug information');
  console.log('\nProcess ID:', process.pid);
  console.log('Debug port:', process.debugPort || 'Not in debug mode');
});

// Keep the process alive
setInterval(() => {
  console.log(`Server still running... (requests: ${requestCount})`);
}, 10000);