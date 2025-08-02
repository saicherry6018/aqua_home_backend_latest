
# Service Request API Documentation

## Base URL
```
{{BASE_URL}}/api/service-requests
```

## Authentication
All endpoints require Bearer token authentication:
```
Authorization: Bearer <your-jwt-token>
```

## Status Flow
Service requests follow this strict status flow:
```
CREATED → ASSIGNED → SCHEDULED → IN_PROGRESS → PAYMENT_PENDING (if payment required) → COMPLETED
                                             → COMPLETED (if no payment required)
```

## 1. Get All Service Requests

### GET `/api/service-requests`

**Query Parameters:**
- `status` (optional): Filter by status
- `type` (optional): Filter by type
- `franchiseId` (optional): Filter by franchise
- `customerId` (optional): Filter by customer

**Response:**
```json
{
  "serviceRequests": [
    {
      "id": "srq_123456789",
      "customerId": "usr_123",
      "productId": "prd_123",
      "type": "maintenance",
      "description": "AC not cooling properly",
      "status": "CREATED",
      "images": ["https://s3.../image1.jpg"],
      "assignedAgent": null,
      "franchiseId": "frn_123",
      "scheduledDate": null,
      "beforeImages": [],
      "afterImages": [],
      "requiresPayment": false,
      "paymentAmount": null,
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:30:00Z",
      "customer": {
        "id": "usr_123",
        "name": "John Doe",
        "phone": "+91234567890"
      },
      "product": {
        "id": "prd_123",
        "name": "Split AC 1.5 Ton",
        "model": "LG-AC-15T"
      }
    }
  ]
}
```

## 2. Get Service Request by ID

### GET `/api/service-requests/{id}`

**Response:**
```json
{
  "serviceRequest": {
    "id": "srq_123456789",
    // ... same structure as above
    "paymentStatus": {
      "status": "PENDING",
      "amount": 500,
      "method": null,
      "paidDate": null
    }
  }
}
```

## 3. Assign Agent to Service Request

### POST `/api/service-requests/{id}/assign`

**Body:**
```json
{
  "assignedToId": "usr_agent_123"
}
```

**Response:**
```json
{
  "message": "Service agent assigned",
  "serviceRequest": {
    "id": "srq_123456789",
    "status": "ASSIGNED",
    "assignedAgent": {
      "id": "usr_agent_123",
      "name": "Agent Smith",
      "phone": "+91987654321"
    }
    // ... rest of service request data
  }
}
```

## 4. Update Service Request Status

### PATCH `/api/service-requests/{id}/status`

**Content-Type:** `multipart/form-data`

### Examples for Each Status Transition:

#### A. Schedule Service Request (ASSIGNED → SCHEDULED)

**Form Data:**
```
status: "SCHEDULED"
scheduledDate: "2024-01-20T14:00:00Z"
```

**Response:**
```json
{
  "message": "Service request status updated",
  "serviceRequest": {
    "id": "srq_123456789",
    "status": "SCHEDULED",
    "scheduledDate": "2024-01-20T14:00:00Z"
    // ... rest of data
  }
}
```

#### B. Start Service Work (SCHEDULED → IN_PROGRESS)

**Form Data (for installation services):**
```
status: "IN_PROGRESS"
beforeImages: [File1, File2] // Required for installation type
```

**For non-installation services:**
```
status: "IN_PROGRESS"
```

**Response:**
```json
{
  "message": "Service request status updated",
  "serviceRequest": {
    "id": "srq_123456789",
    "status": "IN_PROGRESS",
    "beforeImages": ["https://s3.../before1.jpg", "https://s3.../before2.jpg"]
    // ... rest of data
  }
}
```

#### C. Complete Service (No Payment Required)

**Form Data:**
```
status: "COMPLETED"
afterImages: [File1, File2] // Required
```

**Response:**
```json
{
  "message": "Service request status updated",
  "serviceRequest": {
    "id": "srq_123456789",
    "status": "COMPLETED",
    "completedDate": "2024-01-20T16:30:00Z",
    "afterImages": ["https://s3.../after1.jpg", "https://s3.../after2.jpg"]
    // ... rest of data
  }
}
```

#### D. Request Payment (Payment Required Services)

**Form Data:**
```
status: "PAYMENT_PENDING"
paymentAmount: 500
afterImages: [File1, File2] // Required
```

**Response:**
```json
{
  "message": "Service request status updated",
  "serviceRequest": {
    "id": "srq_123456789",
    "status": "PAYMENT_PENDING",
    "paymentAmount": 500,
    "afterImages": ["https://s3.../after1.jpg", "https://s3.../after2.jpg"]
    // ... rest of data
  }
}
```

#### E. Complete After Payment

**Form Data:**
```
status: "COMPLETED"
```

**Response:**
```json
{
  "message": "Service request status updated",
  "serviceRequest": {
    "id": "srq_123456789",
    "status": "COMPLETED",
    "completedDate": "2024-01-20T17:00:00Z"
    // ... rest of data
  }
}
```

## 5. Schedule Service Request (Alternative Endpoint)

### POST `/api/service-requests/{id}/schedule`

**Body:**
```json
{
  "scheduledDate": "2024-01-20T14:00:00Z"
}
```

**Response:**
```json
{
  "message": "Service request scheduled",
  "serviceRequest": {
    "id": "srq_123456789",
    "status": "SCHEDULED",
    "scheduledDate": "2024-01-20T14:00:00Z"
    // ... rest of data
  }
}
```

## Error Responses

### 400 Bad Request - Invalid Status Transition
```json
{
  "error": "Bad Request",
  "message": "Invalid status transition from CREATED to IN_PROGRESS. Valid transitions are: ASSIGNED, CANCELLED",
  "statusCode": 400
}
```

### 400 Bad Request - Missing Required Data
```json
{
  "error": "Bad Request",
  "message": "Before images are required to start installation service requests",
  "statusCode": 400
}
```

### 403 Forbidden
```json
{
  "error": "Forbidden",
  "message": "You do not have permission to update this service request",
  "statusCode": 403
}
```

### 404 Not Found
```json
{
  "error": "Not Found",
  "message": "Service Request not found",
  "statusCode": 404
}
```

## Status Transition Rules Summary

| Current Status | Valid Next Status | Required Data | Notes |
|---------------|-------------------|---------------|-------|
| CREATED | ASSIGNED | assignedToId | Must assign agent first |
| ASSIGNED | SCHEDULED | scheduledDate | Agent must be assigned |
| SCHEDULED | IN_PROGRESS | beforeImages (for installation) | Can start work |
| IN_PROGRESS | PAYMENT_PENDING | paymentAmount, afterImages | For services requiring payment |
| IN_PROGRESS | COMPLETED | afterImages | For services not requiring payment |
| PAYMENT_PENDING | COMPLETED | - | After payment verification |
| Any except COMPLETED | CANCELLED | - | Can be cancelled anytime |

## Role-Based Permissions

- **ADMIN**: Can perform all operations
- **FRANCHISE_OWNER**: Can manage service requests in their franchise
- **SERVICE_AGENT**: Can update status of assigned service requests
- **CUSTOMER**: Can view their own service requests only

## Image Upload Requirements

- **Format**: JPG, PNG, WEBP
- **Size**: Max 5MB per image
- **Field Names**: 
  - `beforeImages` for before service images
  - `afterImages` for after service completion images
- **Required Scenarios**:
  - Before images: Required for installation type when moving to IN_PROGRESS
  - After images: Required when moving to PAYMENT_PENDING or COMPLETED
