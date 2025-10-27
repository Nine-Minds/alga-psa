/**
 * Documentation Service
 * Provides enhanced API documentation features including:
 * - Interactive Swagger UI with custom themes
 * - Code examples in multiple languages
 * - Authentication examples
 * - WebSocket documentation
 * - Webhook documentation
 * - SDK documentation
 * - Tutorials and guides
 */

export interface CodeExample {
  language: string;
  label: string;
  code: string;
}

export interface ApiExample {
  endpoint: string;
  method: string;
  description: string;
  request?: {
    headers?: Record<string, string>;
    body?: any;
    query?: Record<string, string>;
  };
  response?: {
    status: number;
    body: any;
  };
  codeExamples: CodeExample[];
}

export interface DocumentationSection {
  id: string;
  title: string;
  description: string;
  content: string;
  examples?: ApiExample[];
  subsections?: DocumentationSection[];
}

export class DocumentationService {
  /**
   * Generate enhanced Swagger UI with custom features
   */
  static generateEnhancedSwaggerUI(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Alga PSA API Documentation</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.10.5/swagger-ui.css" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css">
  <style>
    html {
      box-sizing: border-box;
      overflow: -moz-scrollbars-vertical;
      overflow-y: scroll;
    }
    *, *:before, *:after {
      box-sizing: inherit;
    }
    body {
      margin: 0;
      background: #fafafa;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    
    /* Custom Header */
    .api-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      text-align: center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    
    .api-header h1 {
      margin: 0;
      font-size: 2.5em;
      font-weight: 300;
    }
    
    .api-header p {
      margin: 10px 0 0 0;
      font-size: 1.1em;
      opacity: 0.9;
    }
    
    /* Navigation Tabs */
    .doc-tabs {
      background: white;
      border-bottom: 1px solid #e1e5e9;
      padding: 0 20px;
      display: flex;
      overflow-x: auto;
    }
    
    .doc-tab {
      padding: 15px 20px;
      cursor: pointer;
      border-bottom: 3px solid transparent;
      font-weight: 500;
      color: #666;
      text-decoration: none;
      white-space: nowrap;
    }
    
    .doc-tab.active,
    .doc-tab:hover {
      color: #667eea;
      border-bottom-color: #667eea;
    }
    
    /* Content Areas */
    .doc-content {
      display: none;
      padding: 20px;
    }
    
    .doc-content.active {
      display: block;
    }
    
    /* API Key Management */
    .api-key-section {
      background: #f8f9fa;
      border: 1px solid #e1e5e9;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    
    .api-key-input {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-top: 10px;
    }
    
    .api-key-input input {
      flex: 1;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-family: monospace;
    }
    
    .btn {
      padding: 10px 20px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
      text-decoration: none;
      display: inline-block;
      text-align: center;
    }
    
    .btn-primary {
      background: #667eea;
      color: white;
    }
    
    .btn-secondary {
      background: #6c757d;
      color: white;
    }
    
    .btn:hover {
      opacity: 0.9;
    }
    
    /* Code Examples */
    .code-examples {
      margin: 20px 0;
    }
    
    .code-example-tabs {
      display: flex;
      border-bottom: 1px solid #ddd;
      margin-bottom: 0;
    }
    
    .code-example-tab {
      padding: 10px 15px;
      cursor: pointer;
      border: 1px solid #ddd;
      border-bottom: none;
      background: #f8f9fa;
      margin-right: 5px;
      border-radius: 4px 4px 0 0;
    }
    
    .code-example-tab.active {
      background: white;
      border-bottom: 1px solid white;
      margin-bottom: -1px;
    }
    
    .code-example-content {
      border: 1px solid #ddd;
      border-radius: 0 4px 4px 4px;
      overflow: hidden;
    }
    
    /* Status indicators */
    .status-indicator {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 8px;
    }
    
    .status-operational { background: #28a745; }
    .status-warning { background: #ffc107; }
    .status-error { background: #dc3545; }
    
    /* Quick Start Guide */
    .quick-start {
      background: white;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    
    .quick-start h3 {
      margin-top: 0;
      color: #333;
    }
    
    .step {
      margin: 15px 0;
      padding: 15px;
      background: #f8f9fa;
      border-left: 4px solid #667eea;
      border-radius: 0 4px 4px 0;
    }
    
    .step-number {
      background: #667eea;
      color: white;
      width: 25px;
      height: 25px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      margin-right: 10px;
    }
    
    /* Swagger UI Customizations */
    .swagger-ui .topbar {
      display: none;
    }
    
    .swagger-ui .info {
      margin: 0;
    }
    
    .swagger-ui .scheme-container {
      background: white;
      box-shadow: none;
      padding: 20px;
      margin: 20px 0;
      border: 1px solid #e1e5e9;
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="api-header">
    <h1>🚀 Alga PSA API</h1>
    <p>Comprehensive Professional Services Automation API with full REST Level 3 HATEOAS support</p>
  </div>

  <!-- Navigation -->
  <div class="doc-tabs">
    <div class="doc-tab active" onclick="showTab('overview')">📋 Overview</div>
    <div class="doc-tab" onclick="showTab('quickstart')">⚡ Quick Start</div>
    <div class="doc-tab" onclick="showTab('authentication')">🔐 Authentication</div>
    <div class="doc-tab" onclick="showTab('api-reference')">📚 API Reference</div>
    <div class="doc-tab" onclick="showTab('webhooks')">🔗 Webhooks</div>
    <div class="doc-tab" onclick="showTab('sdk')">⚙️ SDKs</div>
    <div class="doc-tab" onclick="showTab('examples')">💡 Examples</div>
  </div>

  <!-- Overview Tab -->
  <div id="overview" class="doc-content active">
    <div class="quick-start">
      <h2>🌟 Welcome to Alga PSA API</h2>
      <p>The Alga PSA API is a comprehensive REST API that follows <strong>Level 3 REST maturity</strong> with full HATEOAS (Hypermedia as the Engine of Application State) support. This means our API is fully self-discoverable and provides hypermedia links in all responses.</p>
      
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 20px 0;">
        <div class="step">
          <h4>🔗 HATEOAS Support</h4>
          <p>Every API response includes <code>_links</code> that guide you to related resources and available actions.</p>
        </div>
        <div class="step">
          <h4>📊 Comprehensive Coverage</h4>
          <p>Over 300 endpoints covering teams, projects, tickets, billing, and more.</p>
        </div>
        <div class="step">
          <h4>🛡️ Secure by Design</h4>
          <p>Built-in authentication, authorization, and comprehensive audit logging.</p>
        </div>
        <div class="step">
          <h4>📈 Real-time Features</h4>
          <p>WebSocket support for real-time updates and webhook integrations.</p>
        </div>
      </div>

      <h3>🎯 API Status</h3>
      <div style="display: flex; gap: 20px; flex-wrap: wrap;">
        <div><span class="status-indicator status-operational"></span> API Gateway: Operational</div>
        <div><span class="status-indicator status-operational"></span> Authentication: Operational</div>
        <div><span class="status-indicator status-operational"></span> Database: Operational</div>
        <div><span class="status-indicator status-operational"></span> Webhooks: Operational</div>
      </div>
    </div>
  </div>

  <!-- Quick Start Tab -->
  <div id="quickstart" class="doc-content">
    <div class="quick-start">
      <h2>⚡ Quick Start Guide</h2>
      <p>Get up and running with the Alga PSA API in minutes!</p>

      <div class="step">
        <span class="step-number">1</span>
        <strong>Get your API Key</strong>
        <p>Contact your administrator or use the API key section below to set up authentication.</p>
      </div>

      <div class="step">
        <span class="step-number">2</span>
        <strong>Make your first request</strong>
        <div class="code-examples">
          <div class="code-example-tabs">
            <div class="code-example-tab active" onclick="showCodeExample('curl')">cURL</div>
            <div class="code-example-tab" onclick="showCodeExample('javascript')">JavaScript</div>
            <div class="code-example-tab" onclick="showCodeExample('python')">Python</div>
          </div>
          <div class="code-example-content">
            <pre id="curl-example"><code class="language-bash">curl -X GET "https://api.algapsa.com/api/v1/teams" \\
  -H "X-API-Key: your-api-key-here" \\
  -H "Content-Type: application/json"</code></pre>
            <pre id="javascript-example" style="display: none;"><code class="language-javascript">const response = await fetch('https://api.algapsa.com/api/v1/teams', {
  headers: {
    'X-API-Key': 'your-api-key-here',
    'Content-Type': 'application/json'
  }
});
const data = await response.json();
console.log(data);</code></pre>
            <pre id="python-example" style="display: none;"><code class="language-python">import requests

headers = {
    'X-API-Key': 'your-api-key-here',
    'Content-Type': 'application/json'
}

response = requests.get('https://api.algapsa.com/api/v1/teams', headers=headers)
data = response.json()
print(data)</code></pre>
          </div>
        </div>
      </div>

      <div class="step">
        <span class="step-number">3</span>
        <strong>Follow the HATEOAS links</strong>
        <p>Use the <code>_links</code> in the response to discover and navigate to related resources!</p>
      </div>
    </div>

    <!-- API Key Management -->
    <div class="api-key-section">
      <h3>🔑 API Key Management</h3>
      <p>Enter your API key below to automatically include it in all API requests from this documentation.</p>
      <div class="api-key-input">
        <input type="password" id="api-key-input" placeholder="Enter your API key" />
        <button class="btn btn-primary" onclick="saveApiKey()">Save Key</button>
        <button class="btn btn-secondary" onclick="clearApiKey()">Clear</button>
      </div>
      <p><small>💡 Your API key is stored locally in your browser and never sent to our servers except as part of API requests.</small></p>
    </div>
  </div>

  <!-- Authentication Tab -->
  <div id="authentication" class="doc-content">
    <div class="quick-start">
      <h2>🔐 Authentication</h2>
      <p>The Alga PSA API uses API keys for authentication. Include your API key in the <code>X-API-Key</code> header with every request.</p>

      <h3>📋 Authentication Methods</h3>
      <div class="step">
        <h4>API Key (Recommended)</h4>
        <p>Include your API key in the request header:</p>
        <pre><code class="language-bash">X-API-Key: your-api-key-here</code></pre>
      </div>

      <div class="step">
        <h4>Bearer Token (Alternative)</h4>
        <p>You can also use Bearer token authentication:</p>
        <pre><code class="language-bash">Authorization: Bearer your-token-here</code></pre>
      </div>

      <h3>🛡️ Security Best Practices</h3>
      <ul>
        <li>Never expose your API key in client-side code</li>
        <li>Use HTTPS for all API requests</li>
        <li>Rotate your API keys regularly</li>
        <li>Use environment variables to store API keys</li>
        <li>Implement proper error handling for authentication failures</li>
      </ul>
    </div>
  </div>

  <!-- API Reference Tab -->
  <div id="api-reference" class="doc-content">
    <div id="swagger-ui"></div>
  </div>

  <!-- Webhooks Tab -->
  <div id="webhooks" class="doc-content">
    <div class="quick-start">
      <h2>🔗 Webhooks</h2>
      <p>Set up real-time notifications for events in your Alga PSA system.</p>

      <h3>📡 Available Events</h3>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px;">
        <div class="step">
          <h4>Team Events</h4>
          <ul>
            <li><code>team.created</code></li>
            <li><code>team.updated</code></li>
            <li><code>team.member.added</code></li>
            <li><code>team.member.removed</code></li>
          </ul>
        </div>
        <div class="step">
          <h4>Project Events</h4>
          <ul>
            <li><code>project.created</code></li>
            <li><code>project.updated</code></li>
            <li><code>project.status.changed</code></li>
            <li><code>project.completed</code></li>
          </ul>
        </div>
        <div class="step">
          <h4>Ticket Events</h4>
          <ul>
            <li><code>ticket.created</code></li>
            <li><code>ticket.updated</code></li>
            <li><code>ticket.assigned</code></li>
            <li><code>ticket.resolved</code></li>
          </ul>
        </div>
      </div>

      <h3>⚙️ Webhook Setup</h3>
      <div class="code-examples">
        <div class="code-example-content">
          <pre><code class="language-bash">curl -X POST "https://api.algapsa.com/api/v1/webhooks" \\
  -H "X-API-Key: your-api-key-here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "My Webhook",
    "url": "https://your-app.com/webhook",
    "event_types": ["ticket.created", "ticket.updated"],
    "is_active": true
  }'</code></pre>
        </div>
      </div>
    </div>
  </div>

  <!-- SDK Tab -->
  <div id="sdk" class="doc-content">
    <div class="quick-start">
      <h2>⚙️ Official SDKs</h2>
      <p>Use our official SDKs to integrate with the Alga PSA API more easily.</p>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px;">
        <div class="step">
          <h4>🟨 JavaScript/TypeScript</h4>
          <pre><code class="language-bash">npm install @alga-psa/api-client</code></pre>
          <a href="#" class="btn btn-primary">View Documentation</a>
        </div>
        <div class="step">
          <h4>🐍 Python</h4>
          <pre><code class="language-bash">pip install alga-psa-client</code></pre>
          <a href="#" class="btn btn-primary">View Documentation</a>
        </div>
        <div class="step">
          <h4>☕ Java</h4>
          <pre><code class="language-xml">&lt;dependency&gt;
  &lt;groupId&gt;com.algapsa&lt;/groupId&gt;
  &lt;artifactId&gt;api-client&lt;/artifactId&gt;
  &lt;version&gt;1.0.0&lt;/version&gt;
&lt;/dependency&gt;</code></pre>
          <a href="#" class="btn btn-primary">View Documentation</a>
        </div>
      </div>

      <h3>🚀 TypeScript Example</h3>
      <div class="code-examples">
        <div class="code-example-content">
          <pre><code class="language-typescript">import { AlgaPSAClient } from '@alga-psa/api-client';

const client = new AlgaPSAClient({
  apiKey: 'your-api-key-here',
  baseUrl: 'https://api.algapsa.com'
});

// Get all teams with automatic HATEOAS link following
const teams = await client.teams.list();

// Create a new team
const newTeam = await client.teams.create({
  team_name: 'Development Team',
  manager_id: 'user-123'
});

// Follow HATEOAS links automatically
const teamMembers = await newTeam.followLink('members');</code></pre>
        </div>
      </div>
    </div>
  </div>

  <!-- Examples Tab -->
  <div id="examples" class="doc-content">
    <div class="quick-start">
      <h2>💡 Common Examples</h2>
      
      <div class="step">
        <h3>Creating a Complete Project Workflow</h3>
        <div class="code-examples">
          <div class="code-example-content">
            <pre><code class="language-javascript">// 1. Create a team
const team = await fetch('/api/v1/teams', {
  method: 'POST',
  headers: { 'X-API-Key': 'your-key', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    team_name: 'Web Development Team',
    manager_id: 'user-123'
  })
});

// 2. Create a project and assign the team
const project = await fetch('/api/v1/projects', {
  method: 'POST',
  headers: { 'X-API-Key': 'your-key', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    project_name: 'E-commerce Website',
    client_id: 'client-456'
  })
});

// 3. Assign team to project using HATEOAS link
const assignment = await fetch(project._links['assign-team'].href, {
  method: 'POST',
  headers: { 'X-API-Key': 'your-key', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    team_id: team.team_id,
    role: 'primary'
  })
});</code></pre>
          </div>
        </div>
      </div>

      <div class="step">
        <h3>Managing Tickets with HATEOAS</h3>
        <div class="code-examples">
          <div class="code-example-content">
            <pre><code class="language-javascript">// Get a ticket
const ticket = await fetch('/api/v1/tickets/ticket-123', {
  headers: { 'X-API-Key': 'your-key' }
}).then(r => r.json());

// Use HATEOAS links to perform actions
if (ticket._links.assign) {
  // Assign ticket
  await fetch(ticket._links.assign.href, {
    method: ticket._links.assign.method,
    headers: { 'X-API-Key': 'your-key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignee_id: 'user-789' })
  });
}

// Add a comment using relationship link
await fetch(ticket._links.comments.href, {
  method: 'POST',
  headers: { 'X-API-Key': 'your-key', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    comment: 'Working on this issue now',
    is_internal: false
  })
});</code></pre>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script src="https://unpkg.com/swagger-ui-dist@5.10.5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.10.5/swagger-ui-standalone-preset.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-core.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js"></script>
  
  <script>
    let swaggerUI;

    // Tab management
    function showTab(tabName) {
      // Hide all content
      document.querySelectorAll('.doc-content').forEach(content => {
        content.classList.remove('active');
      });
      
      // Remove active class from all tabs
      document.querySelectorAll('.doc-tab').forEach(tab => {
        tab.classList.remove('active');
      });
      
      // Show selected content and activate tab
      document.getElementById(tabName).classList.add('active');
      event.target.classList.add('active');
      
      // Initialize Swagger UI when API Reference tab is shown
      if (tabName === 'api-reference' && !swaggerUI) {
        initializeSwaggerUI();
      }
    }

    // Code example management
    function showCodeExample(language) {
      document.querySelectorAll('.code-example-tab').forEach(tab => {
        tab.classList.remove('active');
      });
      
      event.target.classList.add('active');
      
      document.querySelectorAll('[id$="-example"]').forEach(example => {
        example.style.display = 'none';
      });
      
      document.getElementById(language + '-example').style.display = 'block';
    }

    // API Key management
    function saveApiKey() {
      const input = document.getElementById('api-key-input');
      if (input && input.value) {
        localStorage.setItem('algaPsaApiKey', input.value);
        alert('✅ API key saved! It will be automatically included in requests.');
        
        // If Swagger UI is initialized, reload it to use the new key
        if (swaggerUI) {
          initializeSwaggerUI();
        }
      }
    }

    function clearApiKey() {
      localStorage.removeItem('algaPsaApiKey');
      document.getElementById('api-key-input').value = '';
      alert('🗑️ API key cleared!');
    }

    // Initialize Swagger UI
    function initializeSwaggerUI() {
      swaggerUI = SwaggerUIBundle({
        url: '/api/v1/meta/openapi',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        supportedSubmitMethods: ['get', 'post', 'put', 'delete', 'patch'],
        validatorUrl: null,
        displayRequestDuration: true,
        docExpansion: 'list',
        filter: true,
        tryItOutEnabled: true,
        requestInterceptor: function(request) {
          const apiKey = localStorage.getItem('algaPsaApiKey');
          if (apiKey) {
            request.headers['X-API-Key'] = apiKey;
          }
          return request;
        }
      });
    }

    // Initialize on page load
    window.onload = function() {
      // Load saved API key
      const savedKey = localStorage.getItem('algaPsaApiKey');
      if (savedKey) {
        document.getElementById('api-key-input').value = savedKey;
      }
      
      // Initialize syntax highlighting
      if (window.Prism) {
        Prism.highlightAll();
      }
    };
  </script>
</body>
</html>`;
  }

  /**
   * Generate API examples for common use cases
   */
  static getApiExamples(): ApiExample[] {
    return [
      {
        endpoint: '/api/v1/teams',
        method: 'GET',
        description: 'List all teams with pagination',
        request: {
          headers: { 'X-API-Key': 'your-api-key' },
          query: { page: '1', limit: '25' }
        },
        response: {
          status: 200,
          body: {
            success: true,
            data: [
              {
                team_id: 'team-123',
                team_name: 'Development Team',
                manager_id: 'user-456',
                _links: {
                  self: { href: '/api/v1/teams/team-123', method: 'GET', rel: 'self' },
                  members: { href: '/api/v1/teams/team-123/members', method: 'GET', rel: 'related' },
                  projects: { href: '/api/v1/teams/team-123/projects', method: 'GET', rel: 'related' }
                }
              }
            ],
            pagination: {
              page: 1,
              limit: 25,
              total: 1,
              totalPages: 1
            },
            _links: {
              self: { href: '/api/v1/teams?page=1&limit=25', method: 'GET', rel: 'self' },
              create: { href: '/api/v1/teams', method: 'POST', rel: 'create' }
            }
          }
        },
        codeExamples: [
          {
            language: 'curl',
            label: 'cURL',
            code: `curl -X GET "https://api.algapsa.com/api/v1/teams?page=1&limit=25" \\
  -H "X-API-Key: your-api-key-here"`
          },
          {
            language: 'javascript',
            label: 'JavaScript',
            code: `const response = await fetch('/api/v1/teams?page=1&limit=25', {
  headers: { 'X-API-Key': 'your-api-key-here' }
});
const teams = await response.json();`
          },
          {
            language: 'python',
            label: 'Python',
            code: `import requests

response = requests.get('/api/v1/teams', 
  headers={'X-API-Key': 'your-api-key-here'},
  params={'page': 1, 'limit': 25}
)
teams = response.json()`
          }
        ]
      },
      {
        endpoint: '/api/v1/teams',
        method: 'POST',
        description: 'Create a new team',
        request: {
          headers: { 'X-API-Key': 'your-api-key', 'Content-Type': 'application/json' },
          body: {
            team_name: 'New Development Team',
            manager_id: 'user-123'
          }
        },
        response: {
          status: 201,
          body: {
            success: true,
            data: {
              team_id: 'team-789',
              team_name: 'New Development Team',
              manager_id: 'user-123',
              created_at: '2024-01-15T10:30:00Z',
              _links: {
                self: { href: '/api/v1/teams/team-789', method: 'GET', rel: 'self' },
                edit: { href: '/api/v1/teams/team-789', method: 'PUT', rel: 'edit' },
                'add-member': { href: '/api/v1/teams/team-789/members', method: 'POST', rel: 'action' }
              }
            }
          }
        },
        codeExamples: [
          {
            language: 'curl',
            label: 'cURL',
            code: `curl -X POST "https://api.algapsa.com/api/v1/teams" \\
  -H "X-API-Key: your-api-key-here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "team_name": "New Development Team",
    "manager_id": "user-123"
  }'`
          },
          {
            language: 'javascript',
            label: 'JavaScript',
            code: `const response = await fetch('/api/v1/teams', {
  method: 'POST',
  headers: {
    'X-API-Key': 'your-api-key-here',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    team_name: 'New Development Team',
    manager_id: 'user-123'
  })
});
const team = await response.json();`
          }
        ]
      }
    ];
  }

  /**
   * Generate comprehensive documentation sections
   */
  static getDocumentationSections(): DocumentationSection[] {
    return [
      {
        id: 'getting-started',
        title: 'Getting Started',
        description: 'Learn the basics of the Alga PSA API',
        content: `
# Getting Started with Alga PSA API

The Alga PSA API is designed with REST Level 3 maturity, featuring full HATEOAS support. This means every response includes hypermedia links that guide you to related resources and available actions.

## Key Concepts

### HATEOAS (Hypermedia as the Engine of Application State)
Every API response includes a \`_links\` object containing related actions and resources:

\`\`\`json
{
  "data": { ... },
  "_links": {
    "self": { "href": "/api/v1/resource/123", "method": "GET", "rel": "self" },
    "edit": { "href": "/api/v1/resource/123", "method": "PUT", "rel": "edit" },
    "related": { "href": "/api/v1/resource/123/related", "method": "GET", "rel": "related" }
  }
}
\`\`\`

### Discoverability
Start from the API root and follow links to discover all available functionality:

\`\`\`bash
curl -X GET "https://api.algapsa.com/api/v1" -H "X-API-Key: your-key"
\`\`\`
        `,
        subsections: [
          {
            id: 'authentication',
            title: 'Authentication',
            description: 'How to authenticate with the API',
            content: 'Include your API key in the X-API-Key header...'
          }
        ]
      }
    ];
  }
}