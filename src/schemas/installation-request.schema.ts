import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';
import { InstallationRequestStatus } from '../types';

// Create Installation Request (Customer)
const createInstallationRequestBody = z.object({
    productId: z.string(),
    orderType: z.enum(['RENTAL', 'PURCHASE']),
    name: z.string().min(2).max(100),
    phoneNumber: z.string().regex(/^[+]?[\d\s()-]{10,15}$/),
    franchiseId: z.string(),
    installationLatitude: z.string(),
    installationLongitude: z.string(),
    installationAddress: z.string().min(10).max(500)
});

const createInstallationRequestResponse = z.object({
    message: z.string(),
    installationRequest: z.object({
        id: z.string(),
        productId: z.string(),
        customerId: z.string(),
        orderType: z.string(),
        name: z.string(),
        phoneNumber: z.string(),
        franchiseId: z.string(),
        franchiseName: z.string(),
        status: z.string(),
        createdAt: z.string()
    })
});

export const createInstallationRequestSchema = {
    body: zodToJsonSchema(createInstallationRequestBody),
    response: {
        200: zodToJsonSchema(createInstallationRequestResponse)
    }
};

// Get Installation Requests (with filters)
const getInstallationRequestsQuery = z.object({
    status: z.nativeEnum(InstallationRequestStatus).optional(),
    franchiseId: z.string().optional(),
    customerId: z.string().optional(),
    orderType: z.enum(['RENTAL', 'PURCHASE']).optional(),
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(10)
});

const getInstallationRequestsResponse = z.object({
    installationRequests: z.array(z.object({
        id: z.string(),
        productId: z.string(),
        customerId: z.string(),
        orderType: z.string(),
        name: z.string(),
        phoneNumber: z.string(),
        franchiseId: z.string(),
        franchiseName: z.string(),
        status: z.string(),
        installationAddress: z.string(),
        scheduledDate: z.string().nullable(),
        assignedTechnicianId: z.string().nullable(),
        rejectionReason: z.string().nullable(),
        createdAt: z.string(),
        updatedAt: z.string(),
        product: z.object({
            id: z.string(),
            name: z.string(),
            rentPrice: z.number(),
            buyPrice: z.number(),
            deposit: z.number()
        }),
        franchise: z.object({
            id: z.string(),
            name: z.string(),
            city: z.string()
        }),
        customer: z.object({
            id: z.string(),
            name: z.string().nullable(),
            phone: z.string()
        }),
        assignedTechnician: z.object({
            id: z.string(),
            name: z.string().nullable()
        }).nullable()
    })),
    pagination: z.object({
        page: z.number(),
        limit: z.number(),
        total: z.number(),
        totalPages: z.number()
    })
});

export const getInstallationRequestsSchema = {
    querystring: zodToJsonSchema(getInstallationRequestsQuery),
    response: {
        200: zodToJsonSchema(getInstallationRequestsResponse)
    }
};

// Update Status (Franchise Owner/Admin)
const updateStatusBody = z.object({
    status: z.nativeEnum(InstallationRequestStatus),
    comment: z.string().min(1).max(500).optional(),
    scheduledDate: z.string().datetime().optional(),
    assignedTechnicianId: z.string().optional(),
    rejectionReason: z.string().min(1).max(500).optional()
});

export const updateInstallationRequestStatusSchema = {
    params: zodToJsonSchema(z.object({ id: z.string() })),
    body: zodToJsonSchema(updateStatusBody),
    response: {
        200: zodToJsonSchema(z.object({
            message: z.string(),
            installationRequest: z.object({
                id: z.string(),
                status: z.string(),
                updatedAt: z.string()
            })
        }))
    }
};

// Complete Installation (Service Agent) - Creates subscription for rentals
const completeInstallationBody = z.object({
    depositPaid: z.number().positive(),
    paymentMethod: z.enum(['CASH', 'UPI', 'RAZORPAY_MANUAL']),
    receiptImage: z.string().url().optional(),
    installationImages: z.array(z.string().url()).min(1).max(5),
    customerSignature: z.string().url(), // Base64 or URL
    notes: z.string().max(1000).optional()
});

export const completeInstallationSchema = {
    params: zodToJsonSchema(z.object({ id: z.string() })),
    body: zodToJsonSchema(completeInstallationBody),
    response: {
        200: zodToJsonSchema(z.object({
            message: z.string(),
            installationRequest: z.object({
                id: z.string(),
                status: z.string(),
                completedDate: z.string(),
                connectId: z.string().nullable()
            }),
            subscription: z.object({
                id: z.string(),
                connectId: z.string(),
                razorpaySubscriptionId: z.string().nullable()
            }).nullable()
        }))
    }
};

// Get Single Installation Request
export const getInstallationRequestSchema = {
    params: zodToJsonSchema(z.object({ id: z.string() })),
    response: {
        200: zodToJsonSchema(z.object({
            installationRequest: getInstallationRequestsResponse.shape.installationRequests.element,
            actionHistory: z.array(z.object({
                id: z.string(),
                actionType: z.string(),
                fromStatus: z.string().nullable(),
                toStatus: z.string().nullable(),
                comment: z.string().nullable(),
                performedBy: z.string(),
                performedByRole: z.string(),
                createdAt: z.string(),
                performer: z.object({
                    name: z.string().nullable(),
                    role: z.string()
                })
            }))
        }))
    }
};