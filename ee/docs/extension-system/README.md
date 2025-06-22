# Alga PSA Extension System - 80/20 Approach

This directory contains documentation for the Alga PSA Extension System, which enables third-party developers to extend and customize the functionality of Alga PSA. This feature is part of the Alga PSA Enterprise Edition.

## Documentation Index

### Core Architecture
- [Overview](overview.md) - Core architecture and focused approach
- [Development Guide](development_guide.md) - Guide for extension developers
- [Implementation Plan](implementation_plan.md) - Phased implementation with 80/20 focus

### Technical Guides
- [API Routing Guide](api-routing-guide.md) - Dynamic API routing with [extensionId] pattern
- [Template System Guide](template-system-guide.md) - Template variables and expression evaluation
- [DataTable Integration Guide](datatable-integration-guide.md) - DataTable component integration
- [Enterprise Build Workflow](enterprise-build-workflow.md) - EE build process and best practices

### Reference
- [Manifest Schema](manifest_schema.md) - Extension manifest format and examples
- [Sample Template](sample_template.md) - Working extension example

## Purpose

The extension system allows third-party developers and customers to:

1. Add custom UI components to the Alga PSA interface (primary focus)
2. Create custom API endpoints (primary focus)
3. Add custom pages for specific functionality (primary focus)
4. Integrate with external systems
5. Extend the system with future capabilities

## Current Implementation Status

The extension system has been successfully implemented with the following features:

### ✅ Completed Features

- **Descriptor-Based Architecture**: JSON-based UI definitions with template expression evaluation
- **Dynamic API Routing**: Support for `[extensionId]` pattern enabling multi-tenant extensions
- **DataTable Integration**: Full integration with Alga PSA's DataTable component
- **Template System**: Comprehensive template variable substitution and JavaScript expression evaluation
- **Enterprise Build Workflow**: Automated EE → main server file copying process
- **Component Registry**: Automatic mapping of descriptor types to real React components
- **Extension Pages**: Full page rendering with breadcrumbs and navigation
- **Server Actions**: Secure server-side extension operations

### 🚀 Key Architectural Improvements

- **Security**: Sandboxed template evaluation with controlled contexts
- **Performance**: Automatic data loading and caching for table components  
- **Developer Experience**: Declarative JSON descriptors instead of complex React components
- **Maintainability**: Clear separation between EE source files and main server targets
- **Extensibility**: Template expressions support complex JavaScript operations

### 📊 Real-World Example

The SoftwareOne extension demonstrates the full capabilities:
- Dynamic agreement and statement management
- Rich DataTable with sorting, pagination, and filtering
- Template-driven status badges and formatted numbers
- Click handlers for navigation and actions
- API integration with dummy data endpoints

## Recent Updates (Latest Implementation)

### Dynamic API Routing System
- **Pattern**: `/api/extensions/[extensionId]/{endpoint}`
- **Benefits**: Multi-tenant support, no hardcoded extension IDs
- **Template Variables**: Automatic `{{extensionId}}` substitution in descriptors

### Advanced Template Expression Engine
- **Simple Variables**: `{{row.name}}`, `{{params.id}}`
- **Complex Expressions**: `{{row.status === 'active' ? 'success' : 'warning'}}`
- **Method Calls**: `{{row.amount.toLocaleString()}}`
- **Safe Evaluation**: Sandboxed execution with controlled context

### Professional DataTable Integration
- **Real Component**: Uses Alga PSA's production DataTable component
- **Rich Features**: Sorting, pagination, filtering, selection
- **Custom Cells**: Template-driven cell rendering with event handlers
- **Loading States**: Automatic loading spinners and error handling

### Enterprise Build System
- **Source Control**: EE files as single source of truth
- **Automated Copying**: `build-enterprise.sh` script handles deployment
- **Workflow Protection**: Prevents accidental overwrites of changes

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