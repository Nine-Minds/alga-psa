# AI Automation Platform - Enterprise Edition

## Overview

The AI Automation Platform is now part of the Enterprise Edition (EE) of Alga PSA. This separation allows the core UI Reflection System to remain available in the standard edition while providing advanced AI-driven automation capabilities exclusively to enterprise customers.

## Architecture Separation

### Standard Edition Components (Remain in main codebase)
- **UI Reflection System**: `/server/src/types/ui-reflection/`
  - Core UI state management and reflection
  - Component registration hooks
  - Automation ID infrastructure
  - WebSocket broadcasting for UI state updates

### Enterprise Edition Components (Moved to EE)
- **AI Automation Platform**: `/ee/ai-automation/`
  - AI-powered browser automation service
  - Advanced session management
  - Codebase analysis tools
  - Web-based control panel
  - Multi-session orchestration
  - Intelligent script execution

## Benefits of This Separation

### For Standard Edition Users
- Full access to UI automation testing capabilities
- Stable automation IDs for reliable testing
- Real-time UI state monitoring
- No dependency on AI services or advanced automation features

### For Enterprise Edition Users
- Complete AI-driven automation capabilities
- Advanced browser session management
- Intelligent script generation and execution
- Visual control panel for automation monitoring
- Codebase-aware automation planning
- Multi-session parallel automation

## Dependencies

The Enterprise Edition AI Automation Platform depends on the Standard Edition UI Reflection System:

```typescript
// EE AI Automation connects to Standard Edition UI reflection
const socket = io('ws://localhost:8080'); // Standard app WebSocket
socket.on('UI_STATE_UPDATE', (pageState) => {
  // Enterprise AI automation processes UI state from standard edition
});
```

## Deployment Considerations

### Standard Edition
- No changes required to existing deployment
- UI reflection system continues to work independently
- WebSocket server for UI state broadcasting remains part of standard server

### Enterprise Edition
- Additional AI automation service deployment required
- Separate Docker containers for AI automation backend and frontend
- Additional environment variables for OpenAI API keys
- Network connectivity between standard app and AI automation service

## Migration Notes

### For Existing Installations
1. Standard edition users: No action required
2. Enterprise edition users: Deploy additional AI automation service from `/ee/ai-automation/`

### Configuration Updates
- Standard edition: No configuration changes
- Enterprise edition: Add AI automation service to docker-compose setup
- Update any direct references to `tools/ai-automation` to `ee/ai-automation`

## Development Workflow

### Working on UI Reflection (Standard)
```bash
cd /path/to/alga-psa/server
# Work on UI reflection components in src/types/ui-reflection/
```

### Working on AI Automation (Enterprise)
```bash
cd /path/to/alga-psa/ee/ai-automation
# Work on AI automation platform
npm run dev
```

## Testing

### Standard Edition Tests
- UI reflection system tests remain in standard test suite
- No dependency on AI automation services

### Enterprise Edition Tests
- AI automation tests run independently in EE folder
- Integration tests validate connection to standard edition UI reflection

## Support and Licensing

- Standard Edition: Open source components with standard license
- Enterprise Edition: Commercial license required for AI automation platform
- See respective LICENSE.md files for detailed terms