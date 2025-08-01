import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ErrorResponseSchema } from './auth.schema';
import { RentalStatus } from '../types';

// User Schema for subscription relationships
export const UserInSubscriptionSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  phone: z.string(),
  alternativePhone: z.string().nullable().optional(),
  role: z.string(),
  city: z.string().nullable().optional(),
  hasOnboarded: z.boolean().optional(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Product Schema for subscription relationships
export const ProductInSubscriptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  images: z.array(z.string()),
  rentPrice: z.number(),
  buyPrice: z.number(),
  deposit: z.number(),
  isRentable: z.boolean(),
  isPurchasable: z.boolean(),
  isActive: z.boolean(),
});

// Installation Request Schema for subscription relationships
export const InstallationRequestInSubscriptionSchema = z.object({
  id: z.string(),
  productId: z.string(),
  customerId: z.string(),
  orderType: z.string(),
  name: z.string(),
  phoneNumber: z.string(),
  franchiseName: z.string(),
  installationAddress: z.string().nullable().optional(),
  connectId: z.string().nullable().optional(),
  status: z.string(),
  completedDate: z.string().nullable().optional(),
});

// Franchise Schema for subscription relationships
export const FranchiseInSubscriptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
  ownerId: z.string().nullable().optional(),
  isCompanyManaged: z.boolean(),
});

// Subscription Schema
export const SubscriptionSchema = z.object({
  id: z.string(),
  connectId: z.string(),
  requestId: z.string(),
  customerId: z.string(),
  productId: z.string(),
  franchiseId: z.string(),
  planName: z.string(),
  status: z.enum(Object.values(RentalStatus) as [RentalStatus, ...RentalStatus[]]),
  startDate: z.string(),
  endDate: z.string().nullable().optional(),
  currentPeriodStartDate: z.string(),
  currentPeriodEndDate: z.string(),
  nextPaymentDate: z.string(),
  monthlyAmount: z.number(),
  depositAmount: z.number(),
  razorpaySubscriptionId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  customer: UserInSubscriptionSchema.optional().nullable(),
  product: ProductInSubscriptionSchema.optional().nullable(),
  installationRequest: InstallationRequestInSubscriptionSchema.optional().nullable(),
  franchise: FranchiseInSubscriptionSchema.optional().nullable(),
});

// Create Subscription
export const CreateSubscriptionBodySchema = z.object({
  installationRequestId: z.string(),
  planName: z.string(),
  monthlyAmount: z.number().positive(),
  depositAmount: z.number().min(0),
  startDate: z.string().optional(), // If not provided, defaults to today
  endDate: z.string().optional(), // Optional for unlimited rentals
  enableAutoPayment: z.boolean().optional().default(true),
});

export const CreateSubscriptionResponseSchema = z.object({
  message: z.string(),
  subscription: SubscriptionSchema,
  razorpayOrder: z.object({
    id: z.string(),
    amount: z.number(),
    currency: z.string(),
    key: z.string(),
  }).optional(),
});

export const createSubscriptionSchema = {
  body: zodToJsonSchema(CreateSubscriptionBodySchema),
  response: {
    201: zodToJsonSchema(CreateSubscriptionResponseSchema),
    400: zodToJsonSchema(ErrorResponseSchema),
    404: zodToJsonSchema(ErrorResponseSchema),
    403: zodToJsonSchema(ErrorResponseSchema),
  },
  tags: ["subscriptions"],
  summary: "Create a new subscription",
  description: "Create a new subscription for a completed installation request (admin or franchise owner only)",
  security: [{ bearerAuth: [] }],
};

// Check Subscription (Connect ID verification)
export const CheckSubscriptionBodySchema = z.object({
  connectId: z.string(),
  customerPhone: z.string(),
});

export const CheckSubscriptionResponseSchema = z.object({
  isValid: z.boolean(),
  subscription: SubscriptionSchema.optional(),
  message: z.string(),
});

export const checkSubscriptionSchema = {
  body: zodToJsonSchema(CheckSubscriptionBodySchema),
  response: {
    200: zodToJsonSchema(CheckSubscriptionResponseSchema),
    400: zodToJsonSchema(ErrorResponseSchema),
  },
  tags: ["subscriptions"],
  summary: "Check subscription by connect ID",
  description: "Verify if connect ID matches user's active subscription",
};

// Get All Subscriptions
export const GetAllSubscriptionsQuerySchema = z.object({
  status: z.enum(Object.values(RentalStatus) as [RentalStatus, ...RentalStatus[]]).optional(),
  franchiseId: z.string().optional(),
  customerId: z.string().optional(),
  productId: z.string().optional(),
  search: z.string().optional(), // Search by customer name, phone, or connect ID
  page: z.number().min(1).optional().default(1),
  limit: z.number().min(1).max(100).optional().default(20),
});

export const GetAllSubscriptionsResponseSchema = z.object({
  subscriptions: z.array(SubscriptionSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

export const getAllSubscriptionsSchema = {
  querystring: zodToJsonSchema(GetAllSubscriptionsQuerySchema),
  response: {
    200: zodToJsonSchema(GetAllSubscriptionsResponseSchema),
    400: zodToJsonSchema(ErrorResponseSchema),
    403: zodToJsonSchema(ErrorResponseSchema),
  },
  tags: ["subscriptions"],
  summary: "Get all subscriptions",
  description: "Get a list of all subscriptions (admin or franchise owner only)",
  security: [{ bearerAuth: [] }],
};

// Get Subscription by ID
export const GetSubscriptionByIdParamsSchema = z.object({
  id: z.string(),
});

export const GetSubscriptionByIdResponseSchema = z.object({
  subscription: SubscriptionSchema,
});

export const getSubscriptionByIdSchema = {
  params: zodToJsonSchema(GetSubscriptionByIdParamsSchema),
  response: {
    200: zodToJsonSchema(GetSubscriptionByIdResponseSchema),
    403: zodToJsonSchema(ErrorResponseSchema),
    404: zodToJsonSchema(ErrorResponseSchema),
  },
  tags: ["subscriptions"],
  summary: "Get subscription by ID",
  description: "Get a subscription by its ID (permission checks in controller)",
  security: [{ bearerAuth: [] }],
};

// Update Subscription
export const UpdateSubscriptionParamsSchema = z.object({
  id: z.string(),
});

export const UpdateSubscriptionBodySchema = z.object({
  status: z.enum(Object.values(RentalStatus) as [RentalStatus, ...RentalStatus[]]).optional(),
  planName: z.string().optional(),
  monthlyAmount: z.number().positive().optional(),
  endDate: z.string().nullable().optional(),
  nextPaymentDate: z.string().optional(),
  reason: z.string().optional(), // For status changes like pause/terminate
});

export const UpdateSubscriptionResponseSchema = z.object({
  message: z.string(),
  subscription: SubscriptionSchema,
});

export const updateSubscriptionSchema = {
  params: zodToJsonSchema(UpdateSubscriptionParamsSchema),
  body: zodToJsonSchema(UpdateSubscriptionBodySchema),
  response: {
    200: zodToJsonSchema(UpdateSubscriptionResponseSchema),
    400: zodToJsonSchema(ErrorResponseSchema),
    403: zodToJsonSchema(ErrorResponseSchema),
    404: zodToJsonSchema(ErrorResponseSchema),
  },
  tags: ["subscriptions"],
  summary: "Update subscription",
  description: "Update subscription details or status (admin or franchise owner only)",
  security: [{ bearerAuth: [] }],
};

// Pause Subscription
export const PauseSubscriptionParamsSchema = z.object({
  id: z.string(),
});

export const PauseSubscriptionBodySchema = z.object({
  reason: z.string().optional(),
  pauseDuration: z.number().optional(), // Days to pause (optional)
});

export const PauseSubscriptionResponseSchema = z.object({
  message: z.string(),
  subscription: SubscriptionSchema,
});

export const pauseSubscriptionSchema = {
  params: zodToJsonSchema(PauseSubscriptionParamsSchema),
  body: zodToJsonSchema(PauseSubscriptionBodySchema),
  response: {
    200: zodToJsonSchema(PauseSubscriptionResponseSchema),
    400: zodToJsonSchema(ErrorResponseSchema),
    403: zodToJsonSchema(ErrorResponseSchema),
    404: zodToJsonSchema(ErrorResponseSchema),
  },
  tags: ["subscriptions"],
  summary: "Pause subscription",
  description: "Pause an active subscription (admin or franchise owner only)",
  security: [{ bearerAuth: [] }],
};

// Resume Subscription
export const ResumeSubscriptionParamsSchema = z.object({
  id: z.string(),
});

export const ResumeSubscriptionResponseSchema = z.object({
  message: z.string(),
  subscription: SubscriptionSchema,
});

export const resumeSubscriptionSchema = {
  params: zodToJsonSchema(ResumeSubscriptionParamsSchema),
  response: {
    200: zodToJsonSchema(ResumeSubscriptionResponseSchema),
    400: zodToJsonSchema(ErrorResponseSchema),
    403: zodToJsonSchema(ErrorResponseSchema),
    404: zodToJsonSchema(ErrorResponseSchema),
  },
  tags: ["subscriptions"],
  summary: "Resume subscription",
  description: "Resume a paused subscription (admin or franchise owner only)",
  security: [{ bearerAuth: [] }],
};

// Terminate Subscription
export const TerminateSubscriptionParamsSchema = z.object({
  id: z.string(),
});

export const TerminateSubscriptionBodySchema = z.object({
  reason: z.string(),
  refundDeposit: z.boolean().optional().default(false),
});

export const TerminateSubscriptionResponseSchema = z.object({
  message: z.string(),
  subscription: SubscriptionSchema,
});

export const terminateSubscriptionSchema = {
  params: zodToJsonSchema(TerminateSubscriptionParamsSchema),
  body: zodToJsonSchema(TerminateSubscriptionBodySchema),
  response: {
    200: zodToJsonSchema(TerminateSubscriptionResponseSchema),
    400: zodToJsonSchema(ErrorResponseSchema),
    403: zodToJsonSchema(ErrorResponseSchema),
    404: zodToJsonSchema(ErrorResponseSchema),
  },
  tags: ["subscriptions"],
  summary: "Terminate subscription",
  description: "Terminate an active or paused subscription (admin or franchise owner only)",
  security: [{ bearerAuth: [] }],
};