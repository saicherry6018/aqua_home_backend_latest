import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { InstallationRequestStatus, RentalStatus, ServiceRequestStatus, ServiceRequestType, UserRole, PaymentStatus, PaymentType, ActionType } from "../types";
import { InferSelectModel, relations, sql } from "drizzle-orm";
import { boolean } from "drizzle-orm/mysql-core";

export const users = sqliteTable(
    "users",
    {
        id: text("id").primaryKey(),
        phone: text("phone").notNull(),
        role: text("role", { enum: Object.values(UserRole) }).notNull().default(UserRole.CUSTOMER),
        name: text("name"),
        city: text('city'),
        alternativePhone: text("alternative_phone"),
        firebaseUid: text("firebase_uid"),
        hasOnboarded: integer("has_onboarded", { mode: "boolean" }).notNull().default(false),
        isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
        createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
        updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    },
    (users) => ({
        uniquePhoneRole: uniqueIndex("unique_phone_role").on(users.phone, users.role),
    })
);

export const categories = sqliteTable('categories', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)

})

export const products = sqliteTable("products", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    categoryId: text('category_id').references(() => categories.id).notNull(),
    description: text("description").notNull(),
    images: text("images").notNull(), // JSON string array
    rentPrice: integer("rent_price").notNull(),
    buyPrice: integer("buy_price").notNull(),
    deposit: integer("deposit").notNull(),
    isRentable: integer("is_rentable", { mode: "boolean" }).notNull().default(true),
    isPurchasable: integer("is_purchasable", { mode: "boolean" }).notNull().default(true),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const franchises = sqliteTable("franchises", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    city: text("city").notNull(),
    geoPolygon: text("geo_polygon", { mode: 'json' }).notNull(),
    ownerId: text("owner_id")
        .references(() => users.id, {
            onDelete: 'set null', // 👈 Set to NULL if user is deleted
        }),
    isCompanyManaged: integer("is_company_managed", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true)
});

// FIXED: Typo in table name and column name, added missing fields
export const installationRequests = sqliteTable('installation_requests', {
    id: text('id').primaryKey(),
    productId: text('product_id').notNull().references(() => products.id), // Fixed typo
    customerId: text('customer_id').notNull().references(() => users.id),
    orderType: text('order_type').notNull(), // 'RENTAL' | 'PURCHASE'
    name: text("name").notNull(),
    phoneNumber: text('phone_number').notNull(),
    franchiseName: text('franchise_name').notNull(),
    franchiseId: text('franchise_id').notNull().references(() => franchises.id),
    installationLatitude: text('installation_latitude'), // GPS coordinates for installation
    installationLongitude: text('installation_longitude'),
    installationAddress: text('installation_address'),
    connectId: text('connect_id').unique(), // Generated after successful installation
    assignedTechnicianId: text('assigned_technician_id').references(() => users.id),
    scheduledDate: text('scheduled_date'),
    completedDate: text('completed_date'),
    rejectionReason: text('rejection_reason'),
    status: text('status', { enum: Object.values(InstallationRequestStatus) }).notNull().default(InstallationRequestStatus.SUBMITTED),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    razorpayOrderId: text('razorpay_order_id'),
    razorpaySubscriptionId: text('razorpay_subscription_id'),
    autoPaymentEnabled: boolean('auto_payment_enabled').default(false),
});

// Subscriptions table - ONLY for RENTAL orders (not purchases)
export const subscriptions = sqliteTable("subscriptions", {
    id: text("id").primaryKey(),
    connectId: text("connect_id").notNull().unique(), // The connectId users use to login
    requestId: text("request_id").notNull().references(() => installationRequests.id), // Links to installation request
    customerId: text("customer_id").notNull().references(() => users.id),
    productId: text("product_id").notNull().references(() => products.id),
    franchiseId: text("franchise_id").notNull().references(() => franchises.id),
    // orderType is always 'RENTAL' for this table - purchases don't create subscriptions
    planName: text('plan_name').notNull(), // e.g., "Premium Rental Plan"
    status: text("status", { enum: Object.values(RentalStatus) }).notNull().default(RentalStatus.ACTIVE),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"), // Can be NULL for unlimited rentals
    currentPeriodStartDate: text("current_period_start_date").notNull(),
    currentPeriodEndDate: text("current_period_end_date").notNull(),
    nextPaymentDate: text("next_payment_date").notNull(),
    monthlyAmount: integer("monthly_amount").notNull(),
    depositAmount: integer("deposit_amount").notNull(),
    razorpaySubscriptionId: text("razorpay_subscription_id"), // For AutoPay
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const serviceRequests = sqliteTable("service_requests", {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id").references(() => subscriptions.id), // ONLY for rental customers (can be NULL)
    customerId: text("customer_id").notNull().references(() => users.id),
    productId: text("product_id").notNull().references(() => products.id),
    // For purchased products, we still need to know which installation this relates to
    installationRequestId: text("installation_request_id").references(() => installationRequests.id),
    type: text("type", { enum: Object.values(ServiceRequestType) }).notNull(),
    description: text("description").notNull(),
    images: text("images"), // JSON string array for uploaded images
    status: text("status", { enum: Object.values(ServiceRequestStatus) }).notNull().default(ServiceRequestStatus.CREATED),
    assignedToId: text("assigned_to_id").references(() => users.id),
    franchiseId: text("franchise_id").notNull().references(() => franchises.id),
    scheduledDate: text("scheduled_date"),
    completedDate: text("completed_date"),
    beforeImages: text("before_images"), // JSON array - agent uploads before service
    afterImages: text("after_images"), // JSON array - agent uploads after service
    requiresPayment: integer("requires_payment", { mode: "boolean" }).default(false),
    paymentAmount: integer("payment_amount"), // Service charge if applicable
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

// NEW: Payments table for rental subscriptions and service charges
export const payments = sqliteTable("payments", {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id").references(() => subscriptions.id),
    serviceRequestId: text("service_request_id").references(() => serviceRequests.id),
    installationRequestId: text("installation_request_id").references(() => installationRequests.id),
    amount: integer("amount").notNull(),
    type: text("type", { enum: Object.values(PaymentType) }).notNull(),
    status: text("status", { enum: Object.values(PaymentStatus) }).notNull().default(PaymentStatus.PENDING),
    paymentMethod: text("payment_method").notNull(), // 'RAZORPAY_AUTOPAY', 'RAZORPAY_MANUAL', 'CASH', 'UPI'

    // Razorpay fields
    razorpayPaymentId: text("razorpay_payment_id"),
    razorpayOrderId: text("razorpay_order_id"),
    razorpaySubscriptionId: text("razorpay_subscription_id"), // For AutoPay payments

    // Offline payment fields
    collectedByAgentId: text("collected_by_agent_id").references(() => users.id), // Who collected offline payment
    receiptImage: text("receipt_image"), // Agent uploads receipt for offline payments

    // Payment timing
    dueDate: text("due_date"),
    paidDate: text("paid_date"),

    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

// NEW: Action History table to track all state changes
export const actionHistory = sqliteTable("action_history", {
    id: text("id").primaryKey(),

    // Entity reference (one of these will be populated)
    installationRequestId: text("installation_request_id").references(() => installationRequests.id),
    subscriptionId: text("subscription_id").references(() => subscriptions.id),
    serviceRequestId: text("service_request_id").references(() => serviceRequests.id),
    paymentId: text("payment_id").references(() => payments.id),

    // Action details
    actionType: text("action_type", { enum: Object.values(ActionType) }).notNull(),
    fromStatus: text("from_status"), // Previous status
    toStatus: text("to_status"), // New status

    // Actor who performed the action
    performedBy: text("performed_by").notNull().references(() => users.id),
    performedByRole: text("performed_by_role", { enum: Object.values(UserRole) }).notNull(),

    // Additional context
    comment: text("comment"), // Optional comment/reason
    metadata: text("metadata"), // JSON for additional data (e.g., scheduled date, amount, etc.)

    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

// NEW: Push Tokens table for notifications
export const pushTokens = sqliteTable("push_tokens", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    token: text("token").notNull().unique(), // FCM token
    platform: text("platform").notNull(), // 'android', 'ios', 'web'
    deviceId: text("device_id"), // Unique device identifier
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    lastUsed: text("last_used").notNull().default(sql`CURRENT_TIMESTAMP`),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (pushTokens) => ({
    uniqueUserToken: uniqueIndex("unique_user_token").on(pushTokens.userId, pushTokens.token)
}));

// Add this new table to your existing schema.ts file

// NEW: Franchise-Agent Mapping Table
export const franchiseAgents = sqliteTable("franchise_agents", {
    id: text("id").primaryKey(),
    franchiseId: text("franchise_id").notNull().references(() => franchises.id, { onDelete: 'cascade' }),
    agentId: text("agent_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(true), // Primary franchise for agent
    assignedDate: text("assigned_date").notNull().default(sql`CURRENT_TIMESTAMP`),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (franchiseAgents) => ({
    // Ensure unique agent-franchise combination
    uniqueAgentFranchise: uniqueIndex("unique_agent_franchise").on(franchiseAgents.franchiseId, franchiseAgents.agentId),
}));

// Add relations for the new mapping table

// Update Users Relations (add this to your existing usersRelations)
export const usersRelationsUpdated = relations(users, ({ one, many }) => ({
    // ... your existing relations ...

    // Franchise assignments for agents
    franchiseAssignments: many(franchiseAgents, { relationName: "agentFranchiseAssignments" }),
}));

// Update Franchises Relations (add this to your existing franchisesRelations)
export const franchisesRelationsUpdated = relations(franchises, ({ one, many }) => ({
    // ... your existing relations ...

    // Agents assigned to this franchise
    assignedAgents: many(franchiseAgents, { relationName: "franchiseAgentAssignments" }),
}));

// Franchise-Agents Relations
export const franchiseAgentsRelations = relations(franchiseAgents, ({ one }) => ({
    // Franchise this assignment belongs to
    franchise: one(franchises, {
        fields: [franchiseAgents.franchiseId],
        references: [franchises.id],
        relationName: "franchiseAgentAssignments",
    }),

    // Agent in this assignment
    agent: one(users, {
        fields: [franchiseAgents.agentId],
        references: [users.id],
        relationName: "agentFranchiseAssignments",
    }),
}));

// Export the type
export type FranchiseAgent = InferSelectModel<typeof franchiseAgents>;



export const usersRelations = relations(users, ({ one, many }) => ({
    // As franchise owner
    ownedFranchise: one(franchises, {
        fields: [users.id],
        references: [franchises.ownerId],
    }),

    // Installation requests as customer
    installationRequests: many(installationRequests, { relationName: "customerInstallationRequests" }),

    // Installation requests as assigned technician
    assignedInstallations: many(installationRequests, { relationName: "technicianInstallations" }),

    // Subscriptions (only for rental customers)
    subscriptions: many(subscriptions),

    // Service requests as customer
    serviceRequests: many(serviceRequests, { relationName: "customerServiceRequests" }),

    // Service requests as assigned agent
    assignedServiceRequests: many(serviceRequests, { relationName: "agentServiceRequests" }),

    // Payments collected by agent (offline payments)
    collectedPayments: many(payments, { relationName: "agentCollectedPayments" }),

    // Action history performed by this user
    performedActions: many(actionHistory),

    // Push tokens for notifications
    pushTokens: many(pushTokens),
}));

// Products Relations
export const productsRelations = relations(products, ({ many, one }) => ({
    installationRequests: many(installationRequests),
    subscriptions: many(subscriptions),
    serviceRequests: many(serviceRequests),
    owner: one(categories, {
        fields: [products.categoryId],
        references: [categories.id],
    }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({

    products: many(products)

}))

// Franchises Relations
export const franchisesRelations = relations(franchises, ({ one, many }) => ({
    // Franchise owner
    owner: one(users, {
        fields: [franchises.ownerId],
        references: [users.id],
    }),

    // Installation requests in this franchise area
    installationRequests: many(installationRequests),

    // Active subscriptions in this franchise area
    subscriptions: many(subscriptions),

    // Service requests in this franchise area
    serviceRequests: many(serviceRequests),
}));

// Installation Requests Relations
export const installationRequestsRelations = relations(installationRequests, ({ one, many }) => ({
    // Customer who made the request
    customer: one(users, {
        fields: [installationRequests.customerId],
        references: [users.id],
        relationName: "customerInstallationRequests",
    }),

    // Product being installed
    product: one(products, {
        fields: [installationRequests.productId],
        references: [products.id],
    }),

    // Franchise handling the installation
    franchise: one(franchises, {
        fields: [installationRequests.franchiseId],
        references: [franchises.id],
    }),

    // Assigned technician
    assignedTechnician: one(users, {
        fields: [installationRequests.assignedTechnicianId],
        references: [users.id],
        relationName: "technicianInstallations",
    }),

    // Subscription created from this request (only for rentals)
    subscription: one(subscriptions),

    // Service requests for purchased products (linked to installation instead of subscription)
    serviceRequestsForPurchase: many(serviceRequests, { relationName: "purchaseServiceRequests" }),

    // Payments related to this installation (deposit, installation fee)
    payments: many(payments, { relationName: "installationPayments" }),

    // Action history for this installation request
    actionHistory: many(actionHistory, { relationName: "installationActionHistory" }),
}));

// Subscriptions Relations (Only for rental customers)
export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
    // Installation request that created this subscription
    installationRequest: one(installationRequests, {
        fields: [subscriptions.requestId],
        references: [installationRequests.id],
    }),

    // Customer with the subscription
    customer: one(users, {
        fields: [subscriptions.customerId],
        references: [users.id],
    }),

    // Product being rented
    product: one(products, {
        fields: [subscriptions.productId],
        references: [products.id],
    }),

    // Franchise managing this subscription
    franchise: one(franchises, {
        fields: [subscriptions.franchiseId],
        references: [franchises.id],
    }),

    // Service requests for this subscription
    serviceRequests: many(serviceRequests, { relationName: "subscriptionServiceRequests" }),

    // Subscription payments (monthly rentals)
    payments: many(payments, { relationName: "subscriptionPayments" }),

    // Action history for this subscription
    actionHistory: many(actionHistory, { relationName: "subscriptionActionHistory" }),
}));

// Service Requests Relations
export const serviceRequestsRelations = relations(serviceRequests, ({ one, many }) => ({
    // Customer requesting service
    customer: one(users, {
        fields: [serviceRequests.customerId],
        references: [users.id],
        relationName: "customerServiceRequests",
    }),

    // Product needing service
    product: one(products, {
        fields: [serviceRequests.productId],
        references: [products.id],
    }),

    // Franchise handling the service
    franchise: one(franchises, {
        fields: [serviceRequests.franchiseId],
        references: [franchises.id],
    }),

    // Assigned service agent/technician
    assignedAgent: one(users, {
        fields: [serviceRequests.assignedToId],
        references: [users.id],
        relationName: "agentServiceRequests",
    }),

    // For rental customers - linked subscription
    subscription: one(subscriptions, {
        fields: [serviceRequests.subscriptionId],
        references: [subscriptions.id],
        relationName: "subscriptionServiceRequests",
    }),

    // For purchase customers - linked installation request
    installationRequest: one(installationRequests, {
        fields: [serviceRequests.installationRequestId],
        references: [installationRequests.id],
        relationName: "purchaseServiceRequests",
    }),

    // Service charge payments
    payments: many(payments, { relationName: "servicePayments" }),

    // Action history for this service request
    actionHistory: many(actionHistory, { relationName: "serviceActionHistory" }),
}));

// Payments Relations
export const paymentsRelations = relations(payments, ({ one }) => ({
    // Subscription this payment belongs to (for rental payments)
    subscription: one(subscriptions, {
        fields: [payments.subscriptionId],
        references: [subscriptions.id],
        relationName: "subscriptionPayments",
    }),

    // Service request this payment is for (service charges)
    serviceRequest: one(serviceRequests, {
        fields: [payments.serviceRequestId],
        references: [serviceRequests.id],
        relationName: "servicePayments",
    }),

    // Installation request this payment is for (deposit, installation fee)
    installationRequest: one(installationRequests, {
        fields: [payments.installationRequestId],
        references: [installationRequests.id],
        relationName: "installationPayments",
    }),

    // Agent who collected offline payment
    collectedByAgent: one(users, {
        fields: [payments.collectedByAgentId],
        references: [users.id],
        relationName: "agentCollectedPayments",
    }),
}));

// Action History Relations
export const actionHistoryRelations = relations(actionHistory, ({ one }) => ({
    // User who performed this action
    performedByUser: one(users, {
        fields: [actionHistory.performedBy],
        references: [users.id],
    }),

    // Installation request this action relates to
    installationRequest: one(installationRequests, {
        fields: [actionHistory.installationRequestId],
        references: [installationRequests.id],
        relationName: "installationActionHistory",
    }),

    // Subscription this action relates to
    subscription: one(subscriptions, {
        fields: [actionHistory.subscriptionId],
        references: [subscriptions.id],
        relationName: "subscriptionActionHistory",
    }),

    // Service request this action relates to
    serviceRequest: one(serviceRequests, {
        fields: [actionHistory.serviceRequestId],
        references: [serviceRequests.id],
        relationName: "serviceActionHistory",
    }),

    // Payment this action relates to
    payment: one(payments, {
        fields: [actionHistory.paymentId],
        references: [payments.id],
    }),
}));

// Push Tokens Relations
export const pushTokensRelations = relations(pushTokens, ({ one }) => ({
    // User who owns this push token
    user: one(users, {
        fields: [pushTokens.userId],
        references: [users.id],
    }),
}));

export type franchiseArea = InferSelectModel<typeof franchises>;
export type User = InferSelectModel<typeof users>;