# API Getting Started Guide

This guide will help you get started with using the Alga PSA APIs. It's designed for API consumers who want to integrate with our system.

## Note: This document describes pre-release APIs. Many features are not yet available, and APIs are subject to change.

## 1. Introduction

The Alga PSA APIs provide programmatic access to our Professional Services Automation platform. You can use these APIs to:
- Manage tenants and their configurations
- Access and update business data
- Automate workflows
- Integrate with your existing systems

Our APIs follow REST principles and use JSON for request/response payloads. All API access is over HTTPS, and all data is sent and received as JSON.

> 📝 **Note:** The Alga PSA hosted environment is available at `api.algapsa.com`. If you are running an on-premise installation, replace this with your configured domain.

## 2. Obtaining API Access

### Prerequisites
- An active Alga PSA account
- Appropriate permissions to generate API keys

### Generating an API Key
API keys can be generated through our web interface:

1. Log in to your Alga PSA account
2. Click on your profile in the top-right corner
3. Navigate to your User Profile settings
4. Scroll down to the "API Keys" section
5. Click "Generate New API Key"
6. Provide a description (e.g., "Integration Testing")
7. Optionally set an expiration date
8. Save the generated API key securely - it will only be shown once and cannot be retrieved later

## 3. Authentication

All API requests must include your API key in the `x-api-key` header:

```http
GET /api/v1/endpoint
Host: api.algapsa.com
x-api-key: your-api-key-here
```

Example using cURL:
```bash
curl -H "x-api-key: your-api-key-here" https://api.algapsa.com/api/v1/endpoint
```

Example using JavaScript/Node.js:
```javascript
const response = await fetch('https://api.algapsa.com/api/v1/endpoint', {
  headers: {
    'x-api-key': 'your-api-key-here'
  }
});
```

Example using Python:
```python
import requests

headers = {
    'x-api-key': 'your-api-key-here'
}
response = requests.get('https://api.algapsa.com/api/v1/endpoint', headers=headers)
```

## 4. Making Your First API Call

Let's verify your API access by making a simple request:

```bash
curl -H "x-api-key: your-api-key-here" https://api.algapsa.com/api/health
```

Expected successful response:
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

## 5. Understanding Responses

### Success Responses
Successful responses will have a 2xx status code and return JSON data:
```json
{
  "data": {
    "id": "123",
    "name": "Example Resource"
  }
}
```

### Error Responses
Error responses will have a 4xx or 5xx status code and include error details:
```json
{
  "error": {
    "message": "Invalid API key",
    "code": "AUTH001"
  }
}
```

Common HTTP Status Codes:
- 200: Success
- 201: Created
- 400: Bad Request
- 401: Unauthorized (invalid or missing API key)
- 403: Forbidden (valid API key but insufficient permissions)
- 404: Not Found
- 429: Too Many Requests
- 500: Internal Server Error

## 6. Available APIs

### Community Edition APIs
Our Community Edition includes core functionality APIs for:
- Asset Management
- Billing
- Companies/Clients
- Contacts
- Documents
- Projects
- Support Ticketing
- Time Management

### Enterprise Edition APIs
Enterprise Edition includes additional APIs for:
- Tenant Provisioning
- Advanced Workflows
- Custom Integrations

For detailed API documentation, refer to:
- [API Overview](api_overview.md)
- [Tenant Provisioning API](tenant_provisioning_api.md)

## 7. Best Practices

### Security
- Keep your API keys secure and never share them
- Rotate API keys periodically
- Use separate API keys for different integrations
- Set appropriate expiration dates for API keys

### Performance
- Implement proper error handling
- Cache responses when appropriate
- Handle rate limits gracefully
- Use pagination for large data sets

### Integration Tips
- Start with a test environment
- Implement proper logging
- Set up monitoring for API usage
- Keep track of API versions and changes

## 8. Rate Limiting

To ensure fair usage and system stability:
- Implement exponential backoff when encountering rate limits
- Watch for 429 (Too Many Requests) status codes
- Consider implementing request queuing for high-volume operations

Example handling of rate limits:
```javascript
async function makeRequest(url, apiKey, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        headers: { 'x-api-key': apiKey }
      });
      
      if (response.status === 429) {
        // Wait for 2^i seconds before retrying
        await new Promise(resolve => 
          setTimeout(resolve, Math.pow(2, i) * 1000)
        );
        continue;
      }
      
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
    }
  }
}
```

## 9. Support and Resources

- **Documentation:** Visit our [API Overview](api_overview.md) for detailed documentation
- **Support:** Contact our API support team at api-support@algapsa.com
- **Updates:** Subscribe to our API changelog for updates
- **Community:** Join our developer community for discussions and best practices

## 10. Next Steps

1. Generate your API key
2. Make your first API call to verify access
3. Review the detailed API documentation
4. Start building your integration
5. Monitor your API usage
6. Join our developer community

Remember to always test your integration thoroughly in a non-production environment before deploying to production.
