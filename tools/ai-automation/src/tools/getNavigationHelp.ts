import type { Page } from 'puppeteer';
import { Tool } from './Tool.js';

class GetNavigationHelpTool implements Tool {
  name = 'get_navigation_help';
  description = 'Get quick navigation guidance for common screens and actions';

  async execute(page: Page, args: { screen?: string; action?: string }): Promise<any> {
    try {
      const { screen, action } = args;

      // Quick reference for common navigation patterns
      const navigationGuide = {
        overview: "Read docs/ui_navigation_structure.md for complete navigation hierarchy",
        
        commonScreens: {
          "dashboard": {
            route: "/msp/dashboard",
            navigation: "Click 'Dashboard' in sidebar (menu-dashboard)"
          },
          "user-activities": {
            route: "/msp/user-activities", 
            navigation: "Click 'User Activities' in sidebar (menu-user-activities)",
            views: ["cards", "table"],
            sections: ["schedule", "tickets", "projects", "workflow-tasks"]
          },
          "tickets": {
            route: "/msp/tickets",
            navigation: "Click 'Tickets' in sidebar (menu-tickets)"
          },
          "billing": {
            route: "/msp/billing",
            navigation: "Click 'Billing' in sidebar (menu-billing)",
            tabs: ["overview", "invoices", "contract-lines", "service-catalog", "tax-rates"]
          },
          "projects": {
            route: "/msp/projects", 
            navigation: "Click 'Projects' in sidebar (menu-projects)"
          },
          "contacts": {
            route: "/msp/contacts",
            navigation: "Click 'Contacts' in sidebar (menu-contacts)"
          },
          "clients": {
            route: "/msp/clients",
            navigation: "Click 'Clients' in sidebar (menu-clients)",
            views: ["grid", "table"],
            features: ["search", "filters", "bulk-operations", "csv-import-export"],
            details: {
              route: "/msp/clients/[id]",
              tabs: ["details", "tickets", "billing", "billing-dashboard", "contacts", "documents", "tax-settings", "additional-info", "notes", "interactions"],
              keyActions: ["create-client", "edit-client", "delete-client", "manage-locations", "add-ticket"]
            }
          },
          "clients": {
            route: "/msp/clients", 
            navigation: "Click 'Clients' in sidebar (menu-clients)",
            note: "Same as clients - 'Clients' is the menu label for clients"
          }
        },

        navigationPatterns: {
          "sidebar-menu": "All main screens accessible via sidebar (main-sidebar)",
          "tab-navigation": "Some screens like Billing use ?tab= parameters",
          "view-switching": "Some screens have Cards/Table view toggles",
          "filter-to-table": "Filter buttons often switch to table view with applied filters"
        },

        commonActions: {
          "login": "Use helper.type() for username/password fields, helper.click() for submit",
          "navigate-screen": "Use sidebar menu items first, then any tab navigation",
          "create-record": "Look for 'Add' or 'Create' buttons, usually opens drawer/dialog",
          "create-client": "Click 'Create Client' button (create-client-btn) to open QuickAddClient form",
          "view-all": "Use 'View All' buttons to switch to table view with filters",
          "filter-data": "Use filter buttons to open filter dialogs",
          "switch-view": "Use ViewSwitcher component to toggle between Cards/Grid and Table views",
          "bulk-operations": "Use checkboxes to select multiple items, then use bulk action buttons",
          "manage-client": "Use client cards or table rows to access edit/delete, or click to view details",
          "client-details": "Access via client cards/rows, then use tabs for different aspects (billing, tickets, etc.)"
        }
      };

      // If specific screen requested, provide detailed info
      if (screen && navigationGuide.commonScreens[screen.toLowerCase() as keyof typeof navigationGuide.commonScreens]) {
        const screenInfo = navigationGuide.commonScreens[screen.toLowerCase() as keyof typeof navigationGuide.commonScreens];
        return {
          success: true,
          screen: screen.toLowerCase(),
          navigation: screenInfo,
          recommendation: `Read docs/ui_navigation_structure.md for complete ${screen} screen hierarchy`
        };
      }

      // If specific action requested, provide guidance
      if (action && navigationGuide.commonActions[action.toLowerCase() as keyof typeof navigationGuide.commonActions]) {
        const actionInfo = navigationGuide.commonActions[action.toLowerCase() as keyof typeof navigationGuide.commonActions];
        return {
          success: true,
          action: action.toLowerCase(),
          guidance: actionInfo,
          recommendation: "Use search_automation_ids to find specific element IDs for this action"
        };
      }

      // Return overview
      return {
        success: true,
        navigationGuide,
        recommendation: "Read docs/ui_navigation_structure.md for complete navigation hierarchy. Use search_automation_ids to find specific element IDs."
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

export const getNavigationHelp = new GetNavigationHelpTool();