
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Payment schemas
export const PaymentSchema = z.object({
    id: z.string(),
    userId: z.string(),
    subscriptionId: z.string().nullable(),
    serviceRequestId: z.string().nullable(),
    amount: z.number(),
    status: z.enum(['pending', 'completed', 'failed', 'refunded']),
    paymentMethod: z.string(),
    razorpayPaymentId: z.string().nullable(),
    razorpayOrderId: z.string().nullable(),
    franchiseId: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const PaymentWithRelationsSchema = PaymentSchema.extend({
    user: z.object({
        id: z.string(),
        name: z.string(),
        phone: z.string(),
    }).optional(),
    subscription: z.object({
        id: z.string(),
        planName: z.string(),
    }).nullable().optional(),
    franchise: z.object({
        id: z.string(),
        name: z.string(),
        city: z.string(),
    }).optional(),
});

export const ErrorResponseSchema = z.object({
    statusCode: z.number(),
    error: z.string(),
    message: z.string(),
});

// Response schemas
export const GetPaymentsResponseSchema = z.object({
    payments: z.array(PaymentWithRelationsSchema),
    total: z.number(),
});

export const GetPaymentByIdResponseSchema = z.object({
    payment: PaymentWithRelationsSchema,
});

// Route schemas
export const getPaymentsSchema = {
    response: {
        200: zodToJsonSchema(GetPaymentsResponseSchema),
        401: zodToJsonSchema(ErrorResponseSchema),
        403: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["payments"],
    summary: "Get payments based on user role",
    description: "Admin sees all payments, franchise owner sees franchise payments, customer sees own payments",
    security: [{ bearerAuth: [] }],
};

export const getPaymentByIdSchema = {
    params: zodToJsonSchema(z.object({
        id: z.string(),
    })),
    response: {
        200: zodToJsonSchema(GetPaymentByIdResponseSchema),
        401: zodToJsonSchema(ErrorResponseSchema),
        403: zodToJsonSchema(ErrorResponseSchema),
        404: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["payments"],
    summary: "Get payment by ID",
    description: "Get specific payment with role-based access control",
    security: [{ bearerAuth: [] }],
};
