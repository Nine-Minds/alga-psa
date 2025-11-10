# Public Appointment Request API

This API allows unauthenticated users to request appointments and check availability for services that allow public booking.

## Security

- **Rate Limiting**: IP-based rate limiting (5 requests per hour per IP address)
- **Input Validation**: All inputs are validated using Zod schemas
- **Tenant Validation**: Tenant existence and validity are verified
- **Service Validation**: Only services configured for public booking are accessible

## Endpoints

### POST /api/public/appointment-request

Create a public appointment request (unauthenticated).

**Request Body:**
```json
{
  "tenant": "tenant-slug-or-uuid",
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "company": "Acme Corp",
  "service_id": "uuid",
  "requested_date": "2025-11-15",
  "requested_time": "14:00",
  "requested_duration": 60,
  "message": "Optional description"
}
```

**Response (Success):**
```json
{
  "success": true,
  "reference_number": "APT-ABC123",
  "message": "Your appointment request has been received and is pending approval..."
}
```

**Response (Rate Limited):**
```json
{
  "success": false,
  "error": "Too many appointment requests. Please try again in 60 minutes."
}
```

**Response (Validation Error):**
```json
{
  "success": false,
  "error": "Invalid request data",
  "details": [...]
}
```

---

### GET /api/public/appointment-request/available-services

Get services that allow public booking.

**Query Parameters:**
- `tenant` (required): Tenant slug (12-char hex) or tenant ID (UUID)

**Example:**
```
GET /api/public/appointment-request/available-services?tenant=abc123def456
```

**Response:**
```json
{
  "success": true,
  "services": [
    {
      "service_id": "uuid",
      "service_name": "Initial Consultation",
      "service_description": "30-minute consultation",
      "service_type": "consultation",
      "default_rate": 150.00
    }
  ]
}
```

---

### GET /api/public/appointment-request/available-slots

Get available time slots for a specific date and service.

**Query Parameters:**
- `tenant` (required): Tenant slug (12-char hex) or tenant ID (UUID)
- `service_id` (required): Service UUID
- `date` (required): Date in YYYY-MM-DD format
- `duration` (optional): Duration in minutes (defaults to 60)

**Example:**
```
GET /api/public/appointment-request/available-slots?tenant=abc123def456&service_id=123e4567-e89b-12d3-a456-426614174000&date=2025-11-15&duration=60
```

**Response:**
```json
{
  "success": true,
  "date": "2025-11-15",
  "slots": [
    {
      "start_time": "2025-11-15T09:00:00.000Z",
      "end_time": "2025-11-15T10:00:00.000Z",
      "available": true
    },
    {
      "start_time": "2025-11-15T10:00:00.000Z",
      "end_time": "2025-11-15T11:00:00.000Z",
      "available": true
    }
  ]
}
```

---

## Error Responses

All endpoints use consistent error response format:

```json
{
  "success": false,
  "error": "Error message"
}
```

**HTTP Status Codes:**
- `200`: Success
- `400`: Bad Request (invalid parameters, validation errors)
- `429`: Too Many Requests (rate limit exceeded)
- `500`: Internal Server Error

---

## Tenant Resolution

The API supports both tenant slugs and UUIDs:

- **Tenant Slug**: 12-character hexadecimal string (e.g., `abc123def456`)
- **Tenant UUID**: Full UUID format (e.g., `123e4567-e89b-12d3-a456-426614174000`)

Tenant slugs are automatically resolved to UUIDs internally.

---

## Integration Example

```javascript
// 1. Get available services
const servicesResponse = await fetch(
  '/api/public/appointment-request/available-services?tenant=abc123def456'
);
const { services } = await servicesResponse.json();

// 2. Get available slots
const slotsResponse = await fetch(
  `/api/public/appointment-request/available-slots?tenant=abc123def456&service_id=${serviceId}&date=2025-11-15`
);
const { slots } = await slotsResponse.json();

// 3. Create appointment request
const createResponse = await fetch('/api/public/appointment-request', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tenant: 'abc123def456',
    name: 'John Doe',
    email: 'john@example.com',
    phone: '+1234567890',
    company: 'Acme Corp',
    service_id: serviceId,
    requested_date: '2025-11-15',
    requested_time: '14:00',
    requested_duration: 60,
    message: 'Looking forward to discussing our project'
  })
});
const { reference_number } = await createResponse.json();
```

---

## TODO / Future Enhancements

- [ ] Implement CAPTCHA integration for additional spam protection
- [ ] Create dedicated email templates for appointment confirmations
- [ ] Add MSP notification emails when new public requests are created
- [ ] Implement webhook support for appointment status changes
- [ ] Add support for custom fields based on service configuration
- [ ] Implement timezone support for international bookings
