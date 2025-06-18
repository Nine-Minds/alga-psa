# Notification System Documentation

## Overview

The Alga PSA notification system provides real-time in-app notifications for various events throughout the system. It consists of multiple components working together to deliver notifications to users based on their permissions and preferences.

## Architecture Components

### Core Components

1. **Event Bus System** - Handles event publishing and subscription
2. **Notification Subscriber** - Processes events and creates notifications
3. **Notification Publisher** - Stores notifications and broadcasts them via SSE
4. **Server-Sent Events (SSE)** - Real-time delivery to client browsers
5. **Notification Bell UI** - Frontend component for displaying notifications
6. **Direct Messaging System** - Real-time messaging via Hocuspocus WebSockets

### Data Flow

```
Event Triggered → Event Bus → Notification Subscriber → Notification Publisher → Database + Redis → SSE → Client UI
```

## Quick Start

### 1. Enable Notifications

Notifications are automatically enabled when the application starts. The notification subscriber registers for all configured event types.

### 2. User Interface

Users can access notifications via:
- **Notification Bell** - Shows unread count and recent notifications
- **Messages** - Direct messaging between users
- **Notification Preferences** - Customize which notifications to receive

### 3. Testing

Visit `/msp/debug/notifications` to test the notification system with various debug functions.

## Key Features

- ✅ **Real-time Delivery** - Instant notifications via Server-Sent Events
- ✅ **Event-Driven Architecture** - Responds to system events automatically
- ✅ **User Preferences** - Customizable notification settings per user
- ✅ **Permission-Based Filtering** - Only notify users with appropriate permissions
- ✅ **Direct Messaging** - Real-time messaging between users
- ✅ **Rich Content** - Template-based notifications with dynamic data
- ✅ **Multi-Tenant Support** - Isolated notifications per tenant
- ✅ **Priority Levels** - Low, Normal, High, Urgent priority support

## Documentation Sections

- [Event Notification Recipients](./event-recipients.md) - Who gets notified for each event
- [Technical Implementation](./technical-implementation.md) - Architecture and code structure
- [Configuration Guide](./configuration.md) - How to configure notifications
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions
- [API Reference](./api-reference.md) - Server actions and endpoints

## Recent Updates

- **Phase 1-3 Complete**: Core infrastructure, event integration, and direct messaging
- **Real-time Delivery**: SSE and WebSocket implementation working
- **Event Alignment**: Using existing automation hub events
- **Database Optimization**: Proper tenant connection patterns
- **Multi-Handler Support**: EventBus processes all handlers correctly

## Support

For technical support or bug reports, see the [Troubleshooting Guide](./troubleshooting.md) or use the debug interface at `/msp/debug/notifications`.