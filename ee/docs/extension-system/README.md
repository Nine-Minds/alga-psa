# Alga PSA Extension System - 80/20 Approach

This directory contains documentation for the Alga PSA Extension System, which enables third-party developers to extend and customize the functionality of Alga PSA. This feature is part of the Alga PSA Enterprise Edition.

## Documentation Index

- [Overview](overview.md) - Core architecture and focused approach
- [Manifest Schema](manifest_schema.md) - Extension manifest format and examples
- [Implementation Plan](implementation_plan.md) - Phased implementation with 80/20 focus
- [Development Guide](development_guide.md) - Guide for extension developers
- [Sample Template](sample_template.md) - Working extension example

## Purpose

The extension system allows third-party developers and customers to:

1. Add custom UI components to the Alga PSA interface (primary focus)
2. Create custom API endpoints (primary focus)
3. Add custom pages for specific functionality (primary focus)
4. Integrate with external systems
5. Extend the system with future capabilities

## Current Focus (80/20 Approach)

The initial implementation focuses on delivering 80% of the value with 20% of the effort:

- **Core Extension Registry**: Basic extension registration, activation, and management
- **Navigation Extensions**: Custom navigation menu items
- **Dashboard Widgets**: Custom dashboard components
- **Custom Pages**: Standalone pages for extension functionality
- **Basic API Endpoints**: Simple custom API endpoints
- **Simple Security Model**: Basic permission system and manual approval

## Future Expansion

After delivering the core functionality, we'll expand to include:

- Advanced security features (certificate-based signing)
- Entity page extensions and form customizations
- Workflow integration (actions, triggers, forms)
- Data extensions (custom fields, reports)
- Extension marketplace

## Getting Started

For developers looking to create extensions, start with the [Development Guide](development_guide.md) and review the [Sample Template](sample_template.md).

For implementers, review the [Implementation Plan](implementation_plan.md) for details on the phased approach focused on delivering high-value features first.