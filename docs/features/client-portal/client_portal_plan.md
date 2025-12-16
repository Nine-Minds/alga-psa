This portal will allow your MSP clients to log in and manage their accounts, interact with support, and access necessary information. Below is a detailed plan covering required features, authentication mechanisms, and integration with your existing codebase.

> Note: This document has been updated to reflect the new "client-portal" naming convention.

---

## **System Design for Client Portal**

### **Objectives**

- Provide MSP clients with a secure and user-friendly portal.
- Allow clients to view and manage their account information.
- Enable clients to submit and track support tickets.
- Integrate seamlessly with the existing MSP PSA system.
- Maintain strict security and data isolation between tenants.

### **Features**

#### **1. Authentication and Authorization**

- **Secure Client Login**: Implement client-specific authentication to allow clients to log in securely.
- **Role-Based Access Control (RBAC)**: Define client roles (e.g., `ClientUser`, `ClientAdmin`) and permissions.
- **Multi-Factor Authentication (MFA)**: Optional MFA for enhanced security.
- **Password Management**: Allow clients to reset and change passwords securely.

#### **2. Dashboard**

- **Account Overview**: Display account status, active services, and recent activities.
- **Notifications**: Show recent notifications, announcements, or messages from the MSP.

#### **3. Account Management**

- **Profile Management**: Clients can view and update their company and personal contact information.
- **Billing Information**: View billing details, payment methods, and billing cycles.
- **Service Subscriptions**: View subscribed services and request changes or upgrades.

#### **4. Support Ticketing**

- **Ticket Submission**: Create new support tickets with the ability to attach files.
- **Ticket Tracking**: View the status, history, and details of existing tickets.
- **Communication**: Add comments to tickets and receive updates from support staff.

#### **5. Invoices and Payments**

- **Invoice Access**: View and download current and past invoices.
- **Payment Processing**: Make online payments through integrated payment gateways.
- **Billing History**: View payment history and upcoming billing dates.

#### **6. Knowledge Base**

- **Documentation Access**: Browse and search articles, FAQs, and guides.
- **Search Functionality**: Implement search to find relevant documentation quickly.

#### **7. Reporting and Analytics**

- **Usage Reports**: Access reports on service usage, time entries, and support metrics.
- **Custom Reports**: Allow clients to generate and export custom reports.

#### **8. Asset Management (Optional)**

- **Asset Overview**: View a list of assets managed by the MSP.
- **Asset Details**: Access detailed information about each asset, including maintenance schedules.

#### **9. Notifications and Announcements**

- **System Alerts**: Receive notifications about system maintenance or outages.
- **Announcements**: Stay informed about new services or changes.

#### **10. Settings and Preferences**

- **Notification Preferences**: Clients can manage how they receive notifications.
- **Language and Localization**: Support for multiple languages if needed.

---

## **System Integration**

### **1. Codebase Structure**

Based on your codebase, integration points are:

- **Frontend**: Under `app/`, create a new directory `client-portal/` with its own `layout.tsx` and pages.
- **Components**: Reuse UI components from `components/` and `components/ui/`.
- **Backend**: Create new API routes under `app/api/client-portal/` for client-specific data handling.

### **2. Authentication Mechanism**

#### **Separate Authentication Flow**

- **Route Segregation**: Authentication routes are now separated by portal type:
  - **MSP Portal**: `/auth/msp/signin` and `/auth/msp/forgot-password`
  - **Client Portal**: `/auth/client-portal/signin` and `/auth/client-portal/forgot-password`
- **Shared Password Reset**: `/auth/password-reset/set-new-password` (used by both portals)
- **Client Sessions**: Use `next-auth` sessions but with a client-specific strategy.

#### **Implementation Details**

- **Portal-Specific Login Pages**: 
  - MSP portal uses purple theme with features list
  - Client portal uses blue theme, no self-registration
- **User Type Separation**: Database models include `user_type` field (`internal` for MSP, `client` for Client Portal)
- **Authentication Middleware**: Updated to handle both user types and portal-specific redirects
- **Email Service**: Uses `SystemEmailService` for authentication emails (password reset, verification)

### **3. Authorization**

#### **Role-Based Access Control (RBAC)**

- **Roles**: Define roles like `ClientUser`, `ClientAdmin`.
- **Permissions**: Assign permissions to roles using your existing policy engine (`auth/rbac.ts` and `policyEngine.ts`).
- **Policies**: Write policies that enforce tenant isolation and limit clients to their data.

### **4. Tenant Isolation**

- **Middleware Checks**: Ensure that all client requests include a `tenant` identifier.
- **Data Access**: Modify data access layers to filter data by `tenant`.

---

## **Detailed Implementation Plan**

### **Step 1: Set Up Client Authentication**

- **Database Changes**:
  - Add a `userType` column to the `users` table to distinguish between internal users and clients.
  - Ensure that client users are associated with their company (`tenant`).

- **NextAuth Configuration**:
  - Update the `NextAuth` options in `options.ts` to handle different authentication callbacks for clients.
  - Include client-specific session handling and JWT token processing.

- **Authentication Pages**:
  - Create client authentication pages under `app/client-portal/auth/` (e.g., `login.tsx`, `register.tsx`).
  - Implement secure password reset functionality.

- **Authorization Middleware**:
  - Update `authorizationMiddleware.ts` to check the `userType` and restrict access accordingly.
  - Ensure that client users cannot access internal MSP routes.

### **Step 2: Develop the Client Portal UI**

- **Layout and Structure**:
  - Under `app/client-portal/`, create the main layout (`layout.tsx`) and pages.
  - Use `components/layout/` elements to maintain consistency.

- **Dashboard Page**:
  - Create a dashboard (`dashboard/page.tsx`) that summarizes account information.
  - Use existing components or create new ones under `components/client-portal/dashboard/`.

- **Account Management**:
  - Build pages for profile management (`account/page.tsx`), billing information (`billing/page.tsx`), and service subscriptions.
  - Use form components from `components/ui/` like `Input.tsx`, `Select.tsx`, etc.

- **Support Ticketing**:
  - Use the ticket components from `components/tickets/` and adjust them for client use.
  - Ensure that clients can only see and interact with their tickets.

- **Invoices and Payments**:
  - Leverage existing components from `billing-dashboard/` such as `Invoices.tsx`.
  - Implement payment processing using secure APIs.

### **Step 3: Implement API Endpoints**

- **Client Data Endpoints**:
  - Under `app/api/client-portal/`, create endpoints for tickets, invoices, account data, etc.
  - In each handler, enforce tenant isolation by checking the user's `tenant` ID.

- **Data Models and Services**:
  - Use existing models (`models/`) like `Ticket`, `Invoice`, `Company`.
  - Implement or extend services in `lib/services/` to fetch and manipulate client data.

### **Step 4: Security Enhancements**

- **Data Validation**:
  - Sanitize all inputs on the client and server side.
  - Use validation schemas where applicable.

- **Audit Logging**:
  - Implement logging of important actions using `utils/logger.tsx`.
  - Ensure compliance with data protection regulations.

- **Access Control**:
  - Regularly audit permissions and policies to prevent privilege escalation.

### **Step 5: Testing**

- **Unit Tests**:
  - Write unit tests for new components and services.
  - Use Vitest as mentioned in your `README.md`.

- **Integration Tests**:
  - Test API endpoints, authentication flows, and data access.

- **User Acceptance Testing**:
  - Create test client accounts and simulate user interactions.

### **Step 6: Deployment**

- **Environment Configuration**:
  - Set up environment variables for client-specific configurations.
  - Use separate domains or subdomains if necessary.

- **Continuous Integration/Continuous Deployment (CI/CD)**:
  - Update your CI/CD pipelines to include the client portal.
  - Ensure proper build and deployment steps.

---

## **Codebase Integration Points**

### **1. Reuse Existing Components**

- **UI Components**: From `components/ui/`:
  - Forms (`Input.tsx`, `Select.tsx`, `Button.tsx`).
  - Layout components (`Card.tsx`, `Table.tsx`, `Dialog.tsx`).

- **Business Logic Components**:
  - Ticket components (`components/tickets/`).
  - Billing components (`components/billing-dashboard/`).

### **2. Extend Models and Services**

- **Models**: Under `models/`:
  - Extend `User` model to differentiate client users.
  - Ensure relations between `User`, `Company`, and `Tenant` are correctly established.

- **Services**: Under `lib/services/`:
  - Create `clientService.ts` for client-specific operations.
  - Utilize `taxService.ts` for billing calculations if needed.

### **3. Authorization Middleware**

- **Update `authorizationMiddleware.ts`**:
  - Implement functions to extract user roles and permissions.
  - Enforce tenant isolation by checking `x-tenant-id` headers.

### **4. Policy Engine**

- **Use `PolicyEngine.ts`**:
  - Define policies for client access.
  - Enforce policies across API endpoints and UI components.

---

## **Security Considerations**

### **1. Tenant Isolation**

- **Strict Data Access Controls**:
  - Every database query should filter by `tenant` to prevent data leakage.
  - Use query builders that automatically include `tenant` filters.

### **2. Encryption**

- **Data in Transit**:
  - Enforce HTTPS/TLS across the portal.
- **Data at Rest**:
  - Encrypt sensitive data fields in the database using methods from `utils/encryption/`.

### **3. Input Sanitization**

- **Prevent Injection Attacks**:
  - Sanitize inputs on both client and server sides.
  - Use prepared statements and ORM features to prevent SQL injection.

### **4. Logging and Monitoring**

- **Audit Logs**:
  - Log authentication attempts, data access, and significant actions.
- **Monitoring**:
  - Set up monitoring for unusual activities.

---

## **Additional Considerations**

### **1. User Experience**

- **Responsive Design**:
  - Ensure the portal is mobile-friendly.
- **Accessibility**:
  - Follow accessibility standards (e.g., WCAG) to make the portal usable for all clients.

### **2. Internationalization**

- **Localization Support**:
  - If serving international clients, implement localization features.

### **3. Email and Notifications**

- **Email Service**:
  - Use `services/emailService.ts` to send notifications.
- **Notification Preferences**:
  - Allow clients to opt-in or opt-out of certain notifications.

### **4. Documentation**

- **Client Documentation**:
  - Provide guides on how to use the portal.
- **API Documentation**:
  - If exposing APIs, document them for client developers.

### **5. Future Expansion**

- **Modular Design**:
  - Structure the code to allow easy addition of new features.
- **Feedback Mechanism**:
  - Provide a way for clients to submit feedback or request features.

---

## **Conclusion**

By leveraging your existing codebase and adhering to best practices, you can develop a robust client portal that enhances your service offering. Remember to involve stakeholders throughout the development process to ensure that the portal meets client needs.

---

Feel free to ask if you need further details on any specific part of this plan or assistance with implementation steps!
