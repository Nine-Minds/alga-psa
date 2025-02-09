# Customer Provisioning API Documentation

## 2. Use Cases and Requirements
- **Customer Provisioning:** Allow partners to create new customer records.
- **Validation:** Ensure all required customer fields (e.g., company name, contact details, etc.) are provided.
- **Security and Access Control:** Ensure only authorized partner integrations can access the API through robust authentication, role-based authorization, and an augmented NextAuth strategy for API access.
- **Extensibility:** Future endpoints or actions (e.g., updating customer details, deletion) can be easily added.

## 4. API Endpoints
The following endpoints will be defined under the provisioning API:

- **POST `/api/provisioning/customers`:**
  - **Description:** Create a new customer.
  - **Request Body:** JSON payload including mandatory fields (e.g., company name, contact info, etc.).
  - **Response:** JSON confirmation with the newly created customer details or detailed error messages.
  
- **GET `/api/provisioning/customers/:id`:**
  - **Description:** Retrieve details for a specific customer (future enhancement).

- **PATCH/PUT `/api/provisioning/customers/:id`:**
  - **Description:** Update customer details (future enhancement).

- **DELETE `/api/provisioning/customers/:id`:**
  - **Description:** Delete a customer (future enhancement).

## 6. Data Models and Validation
- **Customer Model:** 
  - Leverage and extend the existing company model structure.
  - Key fields include: `name`, `address`, `contactEmail`, `phone`, etc.
- **Schema Validation:** 
  - Define Zod schemas (e.g., in `customer.schema.ts`) for each endpoint to validate and parse incoming JSON payloads.
  - Example Zod schema snippet:
    ```typescript
    import { z } from "zod";
    
    export const CustomerSchema = z.object({
      name: z.string().min(1, "Company name is required"),
      address: z.string().optional(),
      contactEmail: z.string().email("Invalid email address"),
      phone: z.string().optional(),
      // additional fields as needed
    });