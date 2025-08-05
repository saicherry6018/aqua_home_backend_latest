import { and, eq, desc, count, or } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getFastifyInstance } from '../shared/fastify-instance';
import {
    installationRequests,
    products,
    franchises,
    subscriptions,
    payments,
    actionHistory,
    serviceRequests,
    franchiseAgents,
    users
} from '../models/schema';
import {
    InstallationRequestStatus,
    UserRole,
    ActionType,
    PaymentType,
    PaymentStatus,
    ServiceRequestType,
    ServiceRequestStatus
} from '../types';
import { badRequest, forbidden, notFound } from '../utils/errors';
import Razorpay from 'razorpay';
import * as notificationService from './notification.service';

// Create Razorpay instance at the top of your service

// import * as razorpayService from './razorpay.service';
// import * as notificationService from './notification.service';



export async function createInstallationRequest(
    customerId: string,
    data: {
        productId: string;
        orderType: 'RENTAL' | 'PURCHASE';
        name: string;
        phoneNumber: string;
        franchiseId: string;
        installationLatitude: string;
        installationLongitude: string;
        installationAddress: string;
    },
    user: { userId: string; role: UserRole } // Added user parameter
) {
    const fastify = getFastifyInstance();
    const db = fastify.db;
    // Validate product exists and is available for the order type
    const product = await db.query.products.findFirst({
        where: and(
            eq(products.id, data.productId),
            eq(products.isActive, true),
            data.orderType === 'RENTAL' ? eq(products.isRentable, true) : eq(products.isPurchasable, true)
        )
    });

    if (!product) {
        throw badRequest(`Product not available for ${data.orderType.toLowerCase()}`);
    }

    // Validate franchise exists
    const franchise = await db.query.franchises.findFirst({
        where: and(
            eq(franchises.id, data.franchiseId),
            eq(franchises.isActive, true)
        )
    });

    if (!franchise) {
        throw badRequest('Invalid franchise selected');
    }

    const requestId = uuidv4();
    const now = new Date().toISOString();

    // Create installation request
    const [createdRequest] = await db.insert(installationRequests).values({
        id: requestId,
        productId: data.productId,
        customerId,
        orderType: data.orderType,
        name: data.name,
        phoneNumber: data.phoneNumber,
        franchiseId: data.franchiseId,
        franchiseName: franchise.name,
        installationLatitude: data.installationLatitude,
        installationLongitude: data.installationLongitude,
        installationAddress: data.installationAddress,
        status: InstallationRequestStatus.SUBMITTED,
        createdAt: now,
        updatedAt: now
    }).returning();

    // Log action history
    await logActionHistory({
        installationRequestId: requestId,
        actionType: ActionType.INSTALLATION_REQUEST_CREATED,
        fromStatus: undefined,
        toStatus: InstallationRequestStatus.SUBMITTED,
        performedBy: user.userId,
        performedByRole: user.role,
        comment: `Installation request created for ${data.orderType} order`,
        metadata: JSON.stringify({ productId: data.productId, franchiseId: data.franchiseId, orderType: data.orderType })
    });

    // Send push notifications to franchise owner and admins
    const createdRequestWithDetails = await getInstallationRequestById(requestId, user);
    if (createdRequestWithDetails) {
        await sendInstallationRequestNotifications(createdRequestWithDetails, 'created', user);
    }


    return {
        message: 'Installation request created successfully',
        installationRequest: createdRequest
    };
}

export async function getInstallationRequests(
    user: { userId: string; role: UserRole },
    filters: {
        status?: string;
        franchiseId?: string;
        customerId?: string;
        orderType?: 'RENTAL' | 'PURCHASE';
        page?: number;
        limit?: number;
    }
) {
    const fastify = getFastifyInstance();
    const db = fastify.db;
    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const offset = (page - 1) * limit;

    let whereConditions: any[] = [];

    // Role-based filtering
    if (user.role === UserRole.CUSTOMER) {
        whereConditions.push(eq(installationRequests.customerId, user.userId));
    } else if (user.role === UserRole.FRANCHISE_OWNER) {
        // Get franchise owned by this user
        const franchise = await db.query.franchises.findFirst({
            where: eq(franchises.ownerId, user.userId)
        });
        if (franchise) {
            whereConditions.push(eq(installationRequests.franchiseId, franchise.id));
        }
    }
    // ADMIN and SERVICE_AGENT can see all

    // Apply additional filters
    if (filters.status) {
        whereConditions.push(eq(installationRequests.status, filters.status));
    }
    if (filters.franchiseId) {
        whereConditions.push(eq(installationRequests.franchiseId, filters.franchiseId));
    }
    if (filters.customerId) {
        whereConditions.push(eq(installationRequests.customerId, filters.customerId));
    }
    if (filters.orderType) {
        whereConditions.push(eq(installationRequests.orderType, filters.orderType));
    }

    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    // Get requests with relations
    const requests = await db.query.installationRequests.findMany({
        where: whereClause,
        with: {
            product: true,
            franchise: true,
            customer: true,
            assignedTechnician: {
                columns: {
                    id: true,
                    name: true,
                    // phoneNumber: true,
                    // email: true,
                    // role: true,
                }
            }
        },
        orderBy: [desc(installationRequests.createdAt)],
        limit,
        offset
    });

    console.log('requests here ', requests);

    // Get total count
    const [{ total }] = await db.select({ total: count() })
        .from(installationRequests)
        .where(whereClause);

    return {
        installationRequests: requests,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}

export async function getInstallationRequestById(
    requestId: string,
    user: { userId: string; role: UserRole }
) {
    const fastify = getFastifyInstance();
    const db = fastify.db;

    const request = await db.query.installationRequests.findFirst({
        where: eq(installationRequests.id, requestId),
        with: {
            product: true,
            customer: true,
            franchise: true,
            assignedTechnician: true
        }
    });

    if (!request) {
        throw notFound('Installation request');
    }

    // Access control based on user role
    let hasAccess = false;

    switch (user.role) {
        case UserRole.ADMIN:
            hasAccess = true;
            break;

        case UserRole.CUSTOMER:
            // Customers can only view their own requests
            hasAccess = request.customerId === user.userId;
            break;

        case UserRole.SERVICE_AGENT:
            // Service agents can view if:
            // 1. The request is assigned to them as technician
            // 2. The request belongs to their franchise

            if (request.assignedTechnicianId === user.userId) {
                hasAccess = true;
            } else {
                // Check if the service agent is assigned to this franchise
                const agentFranchiseAssignment = await db.query.franchiseAgents.findFirst({
                    where: and(
                        eq(franchiseAgents.agentId, user.userId),
                        eq(franchiseAgents.franchiseId, request.franchiseId),
                        eq(franchiseAgents.isActive, true)
                    )
                });
                hasAccess = !!agentFranchiseAssignment;
            }
            break;

        case UserRole.FRANCHISE_OWNER:
            // Franchise owners can view requests in their franchise
            const ownedFranchise = await db.query.franchises.findFirst({
                where: and(
                    eq(franchises.ownerId, user.userId),
                    eq(franchises.id, request.franchiseId)
                )
            });
            hasAccess = !!ownedFranchise;
            break;

        default:
            hasAccess = false;
    }

    if (!hasAccess) {
        throw forbidden('You do not have permission to view this installation request');
    }

    const returnValue = await db.query.installationRequests.findFirst({
        where: eq(installationRequests.id, requestId),
        with: {
            product: true,
            franchise: true,
            customer: true,
            assignedTechnician: true,
            actionHistory: {
                with: {
                    performedByUser: true
                }
            }
        }
    });

    // Get payment status if in payment pending state
    let paymentStatus = null;
    if (returnValue?.status === InstallationRequestStatus.PAYMENT_PENDING) {
        const payment = await db.query.payments.findFirst({
            where: eq(payments.installationRequestId, requestId)
        });

        paymentStatus = {
            status: payment?.status || 'PENDING',
            amount: request.orderType === 'RENTAL' ? request.product.deposit : request.product.buyPrice,
            method: payment?.paymentMethod,
            paidDate: payment?.paidDate,
            razorpayOrderId: request.razorpayPaymentLink // Fixed: should be razorpayPaymentLink based on schema
        };
    }

    return {
        ...returnValue,
        paymentStatus
    };
}

export async function updateInstallationRequestStatus(
    requestId: string,
    data: {
        status: InstallationRequestStatus;
        comment?: string;
        assignedTechnicianId?: string;
        scheduledDate?: string;
        rejectionReason?: string;
    },
    user: { userId: string; role: UserRole }
) {
    const fastify = getFastifyInstance();
    const db = fastify.db;
    const request = await db.query.installationRequests.findFirst({
        where: eq(installationRequests.id, requestId),
        with: { franchise: true, product: true, customer: true }
    });

    if (!request) {
        throw notFound('Installation request');
    }

    // Only allow specific transitions for installation requests
    const allowedTransitions = {
        [InstallationRequestStatus.SUBMITTED]: [
            InstallationRequestStatus.REJECTED,
            InstallationRequestStatus.FRANCHISE_CONTACTED
        ],
        [InstallationRequestStatus.FRANCHISE_CONTACTED]: [
            InstallationRequestStatus.INSTALLATION_SCHEDULED,
            InstallationRequestStatus.CANCELLED
        ],
        [InstallationRequestStatus.INSTALLATION_SCHEDULED]: [
            InstallationRequestStatus.CANCELLED
        ],
        [InstallationRequestStatus.CANCELLED]: [
            InstallationRequestStatus.FRANCHISE_CONTACTED
        ],
        [InstallationRequestStatus.REJECTED]: [],
        // These statuses are managed by service requests
        [InstallationRequestStatus.INSTALLATION_IN_PROGRESS]: [],
        [InstallationRequestStatus.PAYMENT_PENDING]: [],
        [InstallationRequestStatus.INSTALLATION_COMPLETED]: []
    };

    if (!allowedTransitions[request.status]?.includes(data.status)) {
        throw badRequest(`Cannot transition from ${request.status} to ${data.status}. This status is managed by service requests.`);
    }

    // Authorization check
    if (user.role === UserRole.FRANCHISE_OWNER) {
        if (request.franchise.ownerId !== user.userId) {
            throw forbidden('You can only update requests in your franchise');
        }
    }

    const currentStatus = request.status;
    const now = new Date().toISOString();
    const updateData: any = {
        status: data.status,
        updatedAt: now
    };

    // Handle status-specific updates
    if (data.status === InstallationRequestStatus.INSTALLATION_SCHEDULED) {
        if (!data.assignedTechnicianId || !data.scheduledDate) {
            throw badRequest('Technician and scheduled date required for scheduling');
        }
        updateData.assignedTechnicianId = data.assignedTechnicianId;
        updateData.scheduledDate = data.scheduledDate;

        const serviceRequest = await fastify.db.query.servicerequests.findFirst({
            where: eq(serviceRequests.installationRequestId, requestId)
        })

        if (serviceRequest) {
            await db.update(serviceRequests).set({
                status: ServiceRequestStatus.SCHEDULED,
                assignedToId: data.assignedTechnicianId
            })
        } else {
            await createInstallationServiceRequest(requestId, data.assignedTechnicianId, data.scheduledDate, user);
        }
        // Create service request for installation

    }

    if (data.status === InstallationRequestStatus.REJECTED && data.rejectionReason) {
        updateData.rejectionReason = data.rejectionReason;
    }


    // Update request
    const [updatedRequest] = await db.update(installationRequests)
        .set(updateData)
        .where(eq(installationRequests.id, requestId)).returning();

    const serviceRequest = await fastify.db.query.servicerequests.findFirst({
        where: eq(serviceRequests.installationRequestId, requestId)
    })

    if (serviceRequest) {
        await db.update(serviceRequests).set({
            status:
                data.status === InstallationRequestStatus.CANCELLED
                    ? ServiceRequestStatus.CANCELLED
                    : data.status === InstallationRequestStatus.INSTALLATION_SCHEDULED
                        ? ServiceRequestStatus.SCHEDULED
                        : data.status === InstallationRequestStatus.REJECTED
                            ? ServiceRequestStatus.CANCELLED
                            : serviceRequest.status // keep existing status if none match
        });
    }


    // Log action history
    await logActionHistory({
        installationRequestId: requestId,
        actionType: getActionTypeFromStatus(data.status),
        fromStatus: currentStatus,
        toStatus: data.status,
        performedBy: user.userId,
        performedByRole: user.role,
        comment: data.comment,
        metadata: JSON.stringify({
            assignedTechnicianId: data.assignedTechnicianId,
            scheduledDate: data.scheduledDate,
            rejectionReason: data.rejectionReason
        })
    });

    // Send push notification on status update (e.g., scheduled, cancelled, rejected)
    if (createdRequestWithDetails) { // Assuming createdRequestWithDetails is available or fetch it again
        await sendInstallationRequestNotifications(updatedRequest, data.status, user);
    }

    return {
        message: `Installation request ${data.status.toLowerCase()} successfully`,
        installationRequest: updatedRequest
    };
}

// Helper function to create installation service request
async function createInstallationServiceRequest(
    installationRequestId: string,
    assignedTechnicianId: string,
    scheduledDate: string,
    user: { userId: string; role: UserRole }
) {
    const fastify = getFastifyInstance();
    const db = fastify.db;

    // Check if service request already exists
    const existingServiceRequest = await db.query.serviceRequests.findFirst({
        where: and(
            eq(serviceRequests.installationRequestId, installationRequestId),
            eq(serviceRequests.type, 'INSTALLATION')
        )
    });

    if (existingServiceRequest) {
        // Update existing service request
        await db.update(serviceRequests).set({
            assignedToId: assignedTechnicianId,
            scheduledDate: scheduledDate,
            status: ServiceRequestStatus.SCHEDULED,
            updatedAt: new Date().toISOString()
        }).where(eq(serviceRequests.id, existingServiceRequest.id));
    } else {
        // Create new service request
        const installationRequest = await db.query.installationRequests.findFirst({
            where: eq(installationRequests.id, installationRequestId)
        });

        if (installationRequest) {
            const serviceRequestId = uuidv4();
            await db.insert(serviceRequests).values({
                id: serviceRequestId,
                subscriptionId: null,
                customerId: installationRequest.customerId,
                productId: installationRequest.productId,
                installationRequestId: installationRequestId,
                type: ServiceRequestType.INSTALLATION,
                description: `Installation service for ${installationRequest.name}`,
                images: null,
                status: ServiceRequestStatus.SCHEDULED,
                assignedToId: assignedTechnicianId,
                franchiseId: installationRequest.franchiseId,
                scheduledDate: scheduledDate,
                completedDate: null,
                beforeImages: null,
                afterImages: null,
                requiresPayment: false,
                paymentAmount: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });

            // Log action history
            await logActionHistory({
                serviceRequestId: serviceRequestId,
                actionType: ActionType.SERVICE_REQUEST_CREATED,
                toStatus: ServiceRequestStatus.SCHEDULED,
                performedBy: user.userId,
                performedByRole: user.role,
                comment: 'Installation service request created and scheduled',
                metadata: JSON.stringify({
                    installationRequestId,
                    assignedTechnicianId,
                    scheduledDate
                })
            });
        }
    }
}
export async function markInstallationInProgress(
    requestId: string,
    data: {
        installationImages?: string[];
        notes?: string;
    },
    user: { userId: string; role: UserRole }
) {
    const fastify = getFastifyInstance();
    const db = fastify.db;
    const request = await db.query.installationRequests.findFirst({
        where: eq(installationRequests.id, requestId),
        with: { product: true, customer: true, franchise: true }
    });

    if (!request) {
        throw notFound('Installation request');
    }

    if (request.status !== InstallationRequestStatus.INSTALLATION_SCHEDULED) {
        throw badRequest('Installation must be scheduled to mark in progress');
    }

    const now = new Date().toISOString();

    // Update installation request to in progress
    await db.update(installationRequests)
        .set({
            status: InstallationRequestStatus.INSTALLATION_IN_PROGRESS,
            updatedAt: now
        })
        .where(eq(installationRequests.id, requestId));

    // Also update related service request if exists
    const relatedServiceRequest = await db.query.serviceRequests.findFirst({
        where: and(
            eq(serviceRequests.installationRequestId, requestId),
            eq(serviceRequests.type, 'INSTALLATION')
        )
    });

    if (relatedServiceRequest) {
        await db.update(serviceRequests).set({
            status: 'IN_PROGRESS',
            updatedAt: now
        }).where(eq(serviceRequests.id, relatedServiceRequest.id));

        // Log action history for service request
        await logActionHistory({
            serviceRequestId: relatedServiceRequest.id,
            actionType: ActionType.SERVICE_REQUEST_IN_PROGRESS,
            fromStatus: relatedServiceRequest.status,
            toStatus: 'IN_PROGRESS',
            performedBy: user.userId,
            performedByRole: user.role,
            comment: data.notes,
            metadata: JSON.stringify({ installationRequestId: requestId })
        });
    }

    // Log action history
    await logActionHistory({
        installationRequestId: requestId,
        actionType: ActionType.INSTALLATION_REQUEST_IN_PROGRESS,
        fromStatus: InstallationRequestStatus.INSTALLATION_SCHEDULED,
        toStatus: InstallationRequestStatus.INSTALLATION_IN_PROGRESS,
        performedBy: user.userId,
        performedByRole: user.role,
        comment: data.notes,
        metadata: JSON.stringify({
            installationImages: data.installationImages || []
        })
    });

    // Send push notification to technician, franchise owner, customer and admin
    const updatedRequest = await getInstallationRequestById(requestId, user);
    if (updatedRequest) {
        await sendInstallationRequestNotifications(updatedRequest, 'in_progress', user);
    }


    return {
        message: 'Installation marked in progress',
        installationRequest: {
            id: requestId,
            status: InstallationRequestStatus.INSTALLATION_IN_PROGRESS,
            updatedAt: now
        }
    };
}

export async function generatePaymentLink(
    requestId: string,
    user: { userId: string; role: UserRole }
) {
    const fastify = getFastifyInstance();
    const db = fastify.db;

    const request = await db.query.installationRequests.findFirst({
        where: eq(installationRequests.id, requestId),
        with: { product: true, customer: true, franchise: true }
    });

    if (!request) {
        throw notFound('Installation request');
    }

    if (![InstallationRequestStatus.PAYMENT_PENDING, InstallationRequestStatus.INSTALLATION_IN_PROGRESS].includes(request.status)) {
        throw badRequest('Installation must be in progress or payment pending state to generate payment link');
    }

    // Check permissions
    if (user.role === UserRole.FRANCHISE_OWNER) {
        const franchise = await db.query.franchises.findFirst({
            where: eq(franchises.ownerId, user.userId)
        });
        if (!franchise || franchise.id !== request.franchiseId) {
            throw forbidden('You can only generate payment links for your franchise requests');
        }
    } else if (![UserRole.ADMIN, UserRole.SERVICE_AGENT].includes(user.role)) {
        throw forbidden('You do not have permission to generate payment links');
    }

    const amount = request.orderType === 'RENTAL' ? request.product.deposit : request.product.buyPrice;

    try {
        let paymentLink: any = {};
        let updateData: any = { updatedAt: new Date().toISOString() };
        const razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID!,
            key_secret: process.env.RAZORPAY_KEY_SECRET!,
        });

        // In your service file, import Razorpay directly

        if (request.orderType === 'RENTAL') {
            console.log('Processing rental payment link generation...');

            // Validate required data first
            if (!request.productId) {
                throw new Error('Product ID is required for rental payments');
            }
            if (!request.customerId) {
                throw new Error('Customer ID is required for rental payments');
            }
            if (!amount || amount <= 0) {
                throw new Error('Valid amount is required for rental payments');
            }

            // For rentals, create autopay subscription
            if (!request.razorpaySubscriptionId || !request.razorpayPaymentLink) {
                console.log('Creating new subscription for rental...');

                const planId = `plan_rental_${request.productId}`;
                console.log('Plan ID:', planId);

                // Helper function to ensure plan exists
                const ensurePlanExists = async (planId: string, productId: string, amount: number) => {
                    console.log(`Checking if plan ${planId} exists...`);

                    try {
                        // Try to fetch the plan first
                        const existingPlan = await razorpay.plans.fetch(planId);
                        console.log(`Plan ${planId} found:`, existingPlan.id);
                        return existingPlan.id;
                    } catch (fetchError: any) {
                        console.log('Plan fetch error:', {
                            statusCode: fetchError.statusCode,
                            error: fetchError.error,
                            description: fetchError.error?.description
                        });

                        // Check if it's a 404 (plan not found)
                        if (fetchError.statusCode === 404 ||
                            (fetchError.statusCode === 400 &&
                                fetchError.error?.description?.includes('does not exist'))) {

                            console.log(`Plan ${planId} doesn't exist, creating new plan`);

                            // FIXED: Remove the 'id' field - Razorpay auto-generates it
                            const planData = {
                                period: 'monthly' as const,
                                interval: 1,
                                item: {
                                    name: `Rental Plan - Product ${productId}`,
                                    amount: Math.round(amount * 100), // Ensure it's an integer
                                    currency: 'INR',
                                    description: `Monthly rental subscription for product ${productId}`
                                },
                                notes: {
                                    productId: productId.toString(),
                                    type: 'rental_plan',
                                    createdAt: new Date().toISOString()
                                }
                            };

                            console.log('Creating plan with data:', planData);

                            try {
                                const createdPlan = await razorpay.plans.create(planData);
                                console.log(`Plan created successfully:`, createdPlan.id);
                                return createdPlan.id;
                            } catch (createError: any) {
                                console.error('Plan creation error:', {
                                    statusCode: createError.statusCode,
                                    error: createError.error,
                                    description: createError.error?.description
                                });

                                // Handle race condition - plan might have been created by another request
                                if (createError.error?.description?.includes('already exists')) {
                                    console.log(`Plan was created by another process, trying to find it`);
                                    try {
                                        // Try to find the plan by fetching all plans and looking for matching name
                                        const allPlans = await razorpay.plans.all({ count: 100 });
                                        const matchingPlan = allPlans.items.find((plan: any) =>
                                            plan.item.name.includes(productId) &&
                                            plan.notes?.productId === productId.toString()
                                        );

                                        if (matchingPlan) {
                                            console.log(`Found matching plan: ${matchingPlan.id}`);
                                            return matchingPlan.id;
                                        }
                                    } catch (searchError) {
                                        console.error('Failed to search for existing plan:', searchError);
                                    }
                                }

                                throw new Error(`Failed to create rental plan: ${createError.error?.description || createError.message}`);
                            }
                        } else {
                            // Some other error occurred
                            console.error('Unexpected error while fetching plan:', fetchError);
                            throw new Error(`Failed to verify plan existence: ${fetchError.error?.description || fetchError.message}`);
                        }
                    }
                };

                try {
                    // Ensure the plan exists and get the plan ID
                    const finalPlanId = await ensurePlanExists(planId, request.productId, amount);
                    console.log('Plan verification/creation completed successfully, using plan ID:', finalPlanId);

                    // Now create the subscription
                    const subscriptionData = {
                        plan_id: finalPlanId,
                        customer_notify: 1,
                        quantity: 1,
                        total_count: 12, // 12 months
                        start_at: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // Start tomorrow
                        addons: [{
                            item: {
                                name: 'Installation Deposit',
                                amount: Math.round(amount * 100), // Ensure it's an integer
                                currency: 'INR'
                            }
                        }],
                        notes: {
                            type: 'rental_with_deposit',
                            installationRequestId: requestId,
                            customerId: request.customerId.toString(),
                            productId: request.productId.toString()
                        }
                    };

                    console.log('Creating subscription with data:', subscriptionData);

                    const razorpaySubscription = await razorpay.subscriptions.create(subscriptionData);
                    console.log('Subscription created successfully:', razorpaySubscription.id);

                    updateData.razorpaySubscriptionId = razorpaySubscription.id;
                    updateData.autoPaymentEnabled = true;


                    paymentLink = {
                        subscriptionId: razorpaySubscription.id,
                        amount: amount,
                        currency: 'INR',
                        keyId: process.env.RAZORPAY_KEY_ID,
                        type: 'subscription',
                        shortUrl: razorpaySubscription.short_url
                    };
                    updateData.razorpayPaymentLink = paymentLink.shortUrl

                    console.log('Payment link created successfully:', paymentLink);

                } catch (subscriptionError: any) {
                    console.error('Subscription creation failed:', {
                        statusCode: subscriptionError.statusCode,
                        error: subscriptionError.error,
                        description: subscriptionError.error?.description,
                        message: subscriptionError.message
                    });
                    throw new Error(`Failed to create subscription: ${subscriptionError.error?.description || subscriptionError.message}`);
                }

            } else {
                console.log('Using existing subscription:', request.razorpaySubscriptionId);

                // Subscription already exists, just return the payment link
                paymentLink = {
                    subscriptionId: request.razorpaySubscriptionId,
                    amount: amount,
                    currency: 'INR',
                    keyId: process.env.RAZORPAY_KEY_ID,
                    type: 'subscription'
                };

                console.log('Payment link for existing subscription:', paymentLink);
            }
        }

        console.log('updated data is ', updateData)
        // Update installation request
        await db.update(installationRequests)
            .set(updateData)
            .where(eq(installationRequests.id, requestId));

        // Log action history
        await logActionHistory({
            installationRequestId: requestId,
            actionType: ActionType.PAYMENT_LINK_GENERATED,
            performedBy: user.userId,
            performedByRole: user.role,
            comment: 'Payment link generated',
            metadata: JSON.stringify({
                paymentType: request.orderType,
                amount: amount,
                ...updateData
            })
        });

        return {
            message: 'Payment link generated successfully',
            paymentLink
        };
    } catch (error) {
        console.log('Failed to create payment setup:', error);
        throw badRequest('Failed to generate payment link ');
    }
}

export async function refreshPaymentStatus(
    requestId: string,
    user: { userId: string; role: UserRole }
) {
    const fastify = getFastifyInstance();
    const db = fastify.db;

    const request = await db.query.installationRequests.findFirst({
        where: eq(installationRequests.id, requestId),
        with: { product: true, customer: true }
    });

    if (!request) {
        throw notFound('Installation request');
    }
    console.log('request ', request)
    if (request.status !== InstallationRequestStatus.PAYMENT_PENDING) {
        throw badRequest('Installation must be in payment pending state');
    }

    if (!request.razorpayOrderId && !request.razorpaySubscriptionId) {
        throw badRequest('No payment order or subscription found for this request');
    }

    try {
        let successfulPayment = null;

        // Check subscription payments for rental orders
        if (request.razorpaySubscriptionId && request.orderType === 'RENTAL') {
            const subscription = await fastify.razorpay.subscriptions.fetch(request.razorpaySubscriptionId);
            if (subscription.status === 'active' || subscription.status === 'authenticated') {
                // For subscriptions, check if first payment (deposit) is completed
                const invoices = await fastify.razorpay.invoices.all({
                    subscription_id: request.razorpaySubscriptionId,
                    count: 1
                });

                console.log(' invoices ', invoices)

                if (invoices.items.length > 0 && invoices.items[0].status === 'paid') {
                    successfulPayment = {
                        id: invoices.items[0].payment_id,
                        amount: invoices.items[0].amount,
                        method: 'RAZORPAY_SUBSCRIPTION'
                    };
                }
            }
        }


        if (successfulPayment) {

            console.log('successfulPayment ', successfulPayment)
            // Payment found, complete the installation
            await completeInstallationWithPayment(requestId, {
                razorpayPaymentId: successfulPayment.id,
                method: successfulPayment.method,
                amount: successfulPayment.amount / 100
            }, user);

            return {
                message: 'Payment verified and installation completed',
                paymentStatus: 'COMPLETED',
                paymentDetails: {
                    method: successfulPayment.method,
                    amount: successfulPayment.amount / 100,
                    transactionId: successfulPayment.id
                }
            };
        } else {
            return {
                message: 'Payment not yet received',
                paymentStatus: 'PENDING',
                paymentDetails: null
            };
        }
    } catch (error) {
        console.log('Error checking payment status:', error);
        throw badRequest('Failed to check payment status');
    }
}

export async function verifyPaymentAndComplete(
    requestId: string,
    data: {
        paymentMethod?: 'RAZORPAY' | 'CASH' | 'UPI';
        paymentImage?: string;
        razorpayPaymentId?: string;
        refresh?: boolean;
    },
    user: { userId: string; role: UserRole }
) {
    const fastify = getFastifyInstance();
    const db = fastify.db;

    const request = await db.query.installationRequests.findFirst({
        where: eq(installationRequests.id, requestId),
        with: { product: true, customer: true, franchise: true }
    });

    if (!request) {
        throw notFound('Installation request');
    }

    if (request.status !== InstallationRequestStatus.PAYMENT_PENDING) {
        throw badRequest('Installation must be in payment pending state');
    }

    let paymentVerified = false;
    let paymentDetails: any = null;

    // If refresh is requested and razorpayOrderId exists, check payment status
    if (data.refresh && request.razorpayOrderId) {
        try {
            const payments = await fastify.razorpay.orders.fetchPayments(request.razorpayOrderId);
            const successfulPayment = payments.items.find((payment: any) => payment.status === 'captured');

            if (successfulPayment) {
                paymentVerified = true;
                paymentDetails = {
                    razorpayPaymentId: successfulPayment.id,
                    method: 'RAZORPAY',
                    amount: successfulPayment.amount / 100
                };
            }
        } catch (error) {
            console.error('Error checking payment status:', error);
        }
    }

    // If Razorpay payment ID provided, verify it
    if (data.razorpayPaymentId && !paymentVerified) {
        try {
            const payment = await fastify.razorpay.payments.fetch(data.razorpayPaymentId);
            if (payment.status === 'captured' && payment.order_id === request.razorpayOrderId) {
                paymentVerified = true;
                paymentDetails = {
                    razorpayPaymentId: payment.id,
                    method: 'RAZORPAY',
                    amount: payment.amount / 100
                };
            }
        } catch (error) {
            console.error('Error verifying payment:', error);
        }
    }

    // For manual payment methods (CASH/UPI), require payment image
    if (['CASH', 'UPI'].includes(data.paymentMethod || '') && data.paymentImage) {
        paymentVerified = true;
        paymentDetails = {
            method: data.paymentMethod,
            paymentImage: data.paymentImage,
            amount: request.orderType === 'RENTAL' ? request.product.deposit : request.product.buyPrice
        };
    }

    if (!paymentVerified) {
        throw badRequest('Payment not verified. Please provide valid payment proof or refresh payment status.');
    }

    const now = new Date().toISOString();
    let connectId: string | null = null;
    let subscription = null;

    // For RENTAL orders, create subscription
    if (request.orderType === 'RENTAL') {
        connectId = generateConnectId();
        const subscriptionId = uuidv4();

        // Create subscription
        await db.insert(subscriptions).values({
            id: subscriptionId,
            connectId,
            requestId: requestId,
            customerId: request.customerId,
            productId: request.productId,
            franchiseId: request.franchiseId,
            planName: `${request.product.name} Rental Plan`,
            status: 'ACTIVE',
            startDate: now,
            currentPeriodStartDate: now,
            currentPeriodEndDate: getNextMonthDate(now),
            nextPaymentDate: getNextMonthDate(now),
            monthlyAmount: request.product.rentPrice,
            depositAmount: request.product.deposit,
            createdAt: now,
            updatedAt: now
        });

        subscription = { id: subscriptionId, connectId };
    }

    // Record payment
    await recordDepositPayment(
        subscription?.id || null,
        paymentDetails.amount,
        {
            depositPaymentMethod: paymentDetails.method,
            depositReceiptImage: paymentDetails.paymentImage
        },
        request.orderType === 'PURCHASE' ? requestId : undefined
    );

    // Update installation request to completed
    await db.update(installationRequests)
        .set({
            status: InstallationRequestStatus.INSTALLATION_COMPLETED,
            connectId,
            completedDate: now,
            updatedAt: now
        })
        .where(eq(installationRequests.id, requestId));

    // Also update related service request if exists
    const relatedServiceRequest = await db.query.serviceRequests.findFirst({
        where: and(
            eq(serviceRequests.installationRequestId, requestId),
            eq(serviceRequests.type, 'INSTALLATION')
        )
    });

    if (relatedServiceRequest) {
        await db.update(serviceRequests).set({
            status: 'COMPLETED',
            completedDate: now,
            updatedAt: now
        }).where(eq(serviceRequests.id, relatedServiceRequest.id));

        // Log action history for service request
        await logActionHistory({
            serviceRequestId: relatedServiceRequest.id,
            actionType: ActionType.SERVICE_REQUEST_COMPLETED,
            fromStatus: 'PAYMENT_PENDING',
            toStatus: 'COMPLETED',
            performedBy: user.userId,
            performedByRole: user.role,
            comment: `Payment verified, installation completed`,
            metadata: JSON.stringify({ installationRequestId: requestId, connectId })
        });
    }

    // Log action history
    await logActionHistory({
        installationRequestId: requestId,
        actionType: ActionType.INSTALLATION_REQUEST_COMPLETED,
        fromStatus: InstallationRequestStatus.PAYMENT_PENDING,
        toStatus: InstallationRequestStatus.INSTALLATION_COMPLETED,
        performedBy: user.userId,
        performedByRole: user.role,
        comment: 'Payment verified and installation completed',
        metadata: JSON.stringify({
            connectId,
            paymentMethod: paymentDetails.method,
            razorpayPaymentId: paymentDetails.razorpayPaymentId
        })
    });

    // Send push notification to franchise owner, customer, technician, and admin
    const updatedRequest = await getInstallationRequestById(requestId, user);
    if (updatedRequest) {
        await sendInstallationRequestNotifications(updatedRequest, 'completed', user);
    }

    return {
        message: 'Payment verified and installation completed successfully',
        installationRequest: {
            id: requestId,
            status: InstallationRequestStatus.INSTALLATION_COMPLETED,
            connectId,
            completedDate: now
        },
        subscription
    };
}

// Helper Functions
async function logActionHistory(data: {
    installationRequestId?: string;
    subscriptionId?: string;
    serviceRequestId?: string;
    paymentId?: string;
    actionType: ActionType;
    fromStatus?: string;
    toStatus?: string;
    performedBy: string;
    performedByRole: UserRole;
    comment?: string;
    metadata?: string;
}) {
    const fastify = getFastifyInstance();
    const db = fastify.db;
    await db.insert(actionHistory).values({
        id: uuidv4(),
        ...data,
        createdAt: new Date().toISOString()
    });
}

function getActionTypeFromStatus(status: InstallationRequestStatus): ActionType {
    const mapping = {
        [InstallationRequestStatus.FRANCHISE_CONTACTED]: ActionType.INSTALLATION_REQUEST_CONTACTED,
        [InstallationRequestStatus.INSTALLATION_SCHEDULED]: ActionType.INSTALLATION_REQUEST_SCHEDULED,
        [InstallationRequestStatus.INSTALLATION_IN_PROGRESS]: ActionType.INSTALLATION_REQUEST_IN_PROGRESS,
        [InstallationRequestStatus.PAYMENT_PENDING]: ActionType.INSTALLATION_REQUEST_COMPLETED,
        [InstallationRequestStatus.INSTALLATION_COMPLETED]: ActionType.INSTALLATION_REQUEST_COMPLETED,
        [InstallationRequestStatus.CANCELLED]: ActionType.INSTALLATION_REQUEST_CANCELLED,
        [InstallationRequestStatus.REJECTED]: ActionType.INSTALLATION_REQUEST_REJECTED,
    };
    return mapping[status] || ActionType.INSTALLATION_REQUEST_SUBMITTED;
}

function generateConnectId(): string {
    // Generate a unique 8-character connect ID
    return Math.random().toString(36).substr(2, 8).toUpperCase();
}

function getNextMonthDate(dateString: string): string {
    const date = new Date(dateString);
    date.setMonth(date.getMonth() + 1);
    return date.toISOString();
}

function getValidStatusTransitions(currentStatus: InstallationRequestStatus): InstallationRequestStatus[] {
    const transitions: Record<InstallationRequestStatus, InstallationRequestStatus[]> = {
        [InstallationRequestStatus.SUBMITTED]: [
            InstallationRequestStatus.REJECTED,
            InstallationRequestStatus.FRANCHISE_CONTACTED
        ],
        [InstallationRequestStatus.FRANCHISE_CONTACTED]: [
            InstallationRequestStatus.INSTALLATION_SCHEDULED,
            InstallationRequestStatus.CANCELLED
        ],
        [InstallationRequestStatus.INSTALLATION_SCHEDULED]: [
            InstallationRequestStatus.INSTALLATION_IN_PROGRESS,
            InstallationRequestStatus.CANCELLED
        ],
        [InstallationRequestStatus.INSTALLATION_IN_PROGRESS]: [
            InstallationRequestStatus.PAYMENT_PENDING,
            InstallationRequestStatus.CANCELLED
        ],
        [InstallationRequestStatus.PAYMENT_PENDING]: [
            InstallationRequestStatus.INSTALLATION_COMPLETED
        ],
        [InstallationRequestStatus.CANCELLED]: [
            InstallationRequestStatus.FRANCHISE_CONTACTED,
            InstallationRequestStatus.INSTALLATION_SCHEDULED,
            InstallationRequestStatus.INSTALLATION_IN_PROGRESS
        ],
        [InstallationRequestStatus.REJECTED]: [],
        [InstallationRequestStatus.INSTALLATION_COMPLETED]: []
    };

    return transitions[currentStatus] || [];
}

async function completeInstallationWithPayment(
    requestId: string,
    paymentDetails: {
        razorpayPaymentId?: string;
        method: string;
        amount: number;
        paymentImage?: string;
    },
    user: { userId: string; role: UserRole }
) {
    const fastify = getFastifyInstance();
    const db = fastify.db;

    const request = await db.query.installationRequests.findFirst({
        where: eq(installationRequests.id, requestId),
        with: { product: true, customer: true }
    });

    if (!request) {
        throw notFound('Installation request');
    }

    const now = new Date().toISOString();
    let connectId: string | null = null;
    let subscription = null;

    // For RENTAL orders, create subscription
    if (request.orderType === 'RENTAL') {
        connectId = generateConnectId();
        const subscriptionId = uuidv4();

        await db.insert(subscriptions).values({
            id: subscriptionId,
            connectId,
            requestId: requestId,
            customerId: request.customerId,
            productId: request.productId,
            franchiseId: request.franchiseId,
            planName: `${request.product.name} Rental Plan`,
            status: 'ACTIVE',
            startDate: now,
            currentPeriodStartDate: now,
            currentPeriodEndDate: getNextMonthDate(now),
            nextPaymentDate: getNextMonthDate(now),
            monthlyAmount: request.product.rentPrice,
            depositAmount: request.product.deposit,
            createdAt: now,
            updatedAt: now
        });

        subscription = { id: subscriptionId, connectId };
    }

    // Record payment
    await recordDepositPayment(
        subscription?.id || null,
        paymentDetails.amount,
        {
            depositPaymentMethod: paymentDetails.method,
            depositReceiptImage: paymentDetails.paymentImage
        },
        requestId

    );

    // Update installation request to completed
    await db.update(installationRequests)
        .set({
            status: InstallationRequestStatus.INSTALLATION_COMPLETED,
            connectId,
            completedDate: now,
            updatedAt: now
        })
        .where(eq(installationRequests.id, requestId));

    // Update related service request
    const relatedServiceRequest = await db.query.serviceRequests.findFirst({
        where: and(
            eq(serviceRequests.installationRequestId, requestId),
            eq(serviceRequests.type, 'INSTALLATION')
        )
    });

    if (relatedServiceRequest) {
        await db.update(serviceRequests).set({
            status: 'COMPLETED',
            completedDate: now,
            updatedAt: now
        }).where(eq(serviceRequests.id, relatedServiceRequest.id));

        await logActionHistory({
            serviceRequestId: relatedServiceRequest.id,
            actionType: ActionType.SERVICE_REQUEST_COMPLETED,
            fromStatus: 'PAYMENT_PENDING',
            toStatus: 'COMPLETED',
            performedBy: user.userId,
            performedByRole: user.role,
            comment: `Payment verified, installation completed`,
            metadata: JSON.stringify({ installationRequestId: requestId, connectId })
        });
    }

    // Log action history
    await logActionHistory({
        installationRequestId: requestId,
        actionType: ActionType.INSTALLATION_REQUEST_COMPLETED,
        fromStatus: InstallationRequestStatus.PAYMENT_PENDING,
        toStatus: InstallationRequestStatus.INSTALLATION_COMPLETED,
        performedBy: user.userId,
        performedByRole: user.role,
        comment: 'Payment verified and installation completed',
        metadata: JSON.stringify({
            connectId,
            paymentMethod: paymentDetails.method,
            razorpayPaymentId: paymentDetails.razorpayPaymentId
        })
    });

    return { connectId, subscription };
}

async function recordDepositPayment(
    subscriptionId: string | null,
    amount: number,
    paymentData: {
        depositPaymentMethod?: string;
        depositReceiptImage?: string;
    },
    installationRequestId?: string
) {
    const fastify = getFastifyInstance();
    const db = fastify.db;
    await db.insert(payments).values({
        id: uuidv4(),
        subscriptionId,
        installationRequestId,
        amount,
        type: PaymentType.DEPOSIT,
        paymentMethod: paymentData.depositPaymentMethod || 'CASH',
        status: PaymentStatus.COMPLETED,
        receiptImage: paymentData.depositReceiptImage,
        paidDate: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
}


// Push Notification Helper Functions
async function sendInstallationRequestNotifications(
    request: any, // Replace 'any' with the actual type of installation request
    action: 'created' | 'scheduled' | 'completed' | 'cancelled' | 'reassigned' | 'in_progress',
    currentUser: { userId: string; role: UserRole }
) {
    const fastify = getFastifyInstance();
    const db = fastify.db;

    let title = '';
    let message = '';
    let targetUserIds: string[] = [];
    let targetUserRoles: UserRole[] = [];

    switch (action) {
        case 'created':
            title = 'New Installation Request';
            message = `A new installation request #${request.id} has been created for ${request.customerName}.`;
            targetUserRoles = [UserRole.FRANCHISE_OWNER, UserRole.ADMIN];
            // Also notify service agents if it's not an installation type (this logic might need to be adjusted based on where this function is called)
            if (request.type !== ServiceRequestType.INSTALLATION) {
                const franchiseAgentsReturned = await db.query.franchiseAgents.findMany({
                    where: eq(franchiseAgents.franchiseId, request.franchiseId),
                    columns: { agentId: true },
                });
                targetUserIds.push(...franchiseAgentsReturned.map(agent => agent.agentId));
            }
            break;
        case 'scheduled':
            title = 'Installation Scheduled';
            message = `Installation for request #${request.id} has been scheduled for ${request.scheduledDate} with technician ${request.assignedTechnician.name}.`;
            targetUserRoles = [UserRole.FRANCHISE_OWNER, UserRole.ADMIN];
            if (request.assignedTechnicianId) targetUserIds.push(request.assignedTechnicianId);
            if (request.customerId) targetUserIds.push(request.customerId);
            break;
        case 'completed':
            title = 'Installation Completed';
            message = `Installation for request #${request.id} has been completed.`;
            targetUserRoles = [UserRole.FRANCHISE_OWNER, UserRole.ADMIN];
            if (request.assignedTechnicianId) targetUserIds.push(request.assignedTechnicianId);
            if (request.customerId) targetUserIds.push(request.customerId);
            break;
        case 'cancelled':
            title = 'Installation Cancelled';
            message = `Installation for request #${request.id} has been cancelled.`;
            targetUserRoles = [UserRole.FRANCHISE_OWNER, UserRole.ADMIN];
            if (request.assignedTechnicianId) targetUserIds.push(request.assignedTechnicianId);
            if (request.customerId) targetUserIds.push(request.customerId);
            break;
        case 'reassigned':
            title = 'Installation Reassigned';
            message = `Installation request #${request.id} has been reassigned.`;
            // Logic for previous and new agent notification would be needed here
            break;
        case 'in_progress':
            title = 'Installation In Progress';
            message = `Installation for request #${request.id} is now in progress.`;
            targetUserRoles = [UserRole.FRANCHISE_OWNER, UserRole.ADMIN];
            if (request.assignedTechnicianId) targetUserIds.push(request.assignedTechnicianId);
            if (request.customerId) targetUserIds.push(request.customerId);
            break;
        default:
            return;
    }

    // Fetch users based on roles and explicitly added IDs
    let usersToNotify: any[] = [];

    if (targetUserRoles.length > 0) {
        const roleBasedUsers = await db.query.users.findMany({
            where: or(...targetUserRoles.map(role => eq(users.role, role))),
            columns: { id: true, pushNotificationToken: true }
        });
        usersToNotify.push(...roleBasedUsers);
    }

    if (targetUserIds.length > 0) {
        const specificUsers = await db.query.users.findMany({
            where: or(...targetUserIds.map(id => eq(users.id, id))),
            columns: { id: true, pushNotificationToken: true }
        });
        // Filter out duplicates and users already added by role
        const existingUserIds = new Set(usersToNotify.map(u => u.id));
        specificUsers.forEach(user => {
            if (!existingUserIds.has(user.id)) {
                usersToNotify.push(user);
            }
        });
    }

    // Filter out users who triggered the action and those without tokens
    const finalUsersToNotify = usersToNotify.filter(user => user.id !== currentUser.userId && user.pushNotificationToken);

    if (finalUsersToNotify.length > 0) {
        await notificationService.sendPushNotification({
            title,
            message,
            registrationTokens: finalUsersToNotify.map(user => user.pushNotificationToken),
            data: {
                screen: getTargetScreen(request, action) // Dynamic screen navigation
            }
        });
    }
}

function getTargetScreen(request: any, action: string): string {
    // Determine the screen based on the request and action
    switch (action) {
        case 'created':
            return `/installation-requests/${request.id}`;
        case 'scheduled':
            return `/installation-requests/${request.id}`;
        case 'completed':
            return `/installation-requests/${request.id}`;
        case 'cancelled':
            return `/installation-requests/${request.id}`;
        case 'reassigned':
            return `/installation-requests/${request.id}`;
        case 'in_progress':
            return `/installation-requests/${request.id}`;
        default:
            return '/dashboard'; // Default screen
    }
}

async function registerPushNotificationToken(userId: string, token: string) {
    const fastify = getFastifyInstance();
    const db = fastify.db;

    const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { id: true, pushNotificationToken: true }
    });

    if (!user) {
        throw notFound('User');
    }

    if (user.pushNotificationToken !== token) {
        await db.update(users).set({ pushNotificationToken: token }).where(eq(users.id, userId));
    }
}

async function getUnassignedServiceRequests(
    user: { userId: string; role: UserRole },
    filters: {
        franchiseId?: string;
        type?: string;
        status?: string;
        page?: number;
        limit?: number;
    }
) {
    const fastify = getFastifyInstance();
    const db = fastify.db;
    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const offset = (page - 1) * limit;

    let whereConditions: any[] = [];

    // Filter for unassigned service requests
    whereConditions.push(eq(serviceRequests.assignedToId, null));
    whereConditions.push(eq(serviceRequests.type, ServiceRequestType.INSTALLATION)); // Assuming INSTALLATION type is what needs to be unassigned

    // Add franchise filtering if provided
    if (filters.franchiseId) {
        whereConditions.push(eq(serviceRequests.franchiseId, filters.franchiseId));
    }

    // Add type filtering if provided
    if (filters.type) {
        whereConditions.push(eq(serviceRequests.type, filters.type));
    }

    // Add status filtering if provided
    if (filters.status) {
        whereConditions.push(eq(serviceRequests.status, filters.status));
    }

    // Role-based filtering for franchise owner and admin
    if (user.role === UserRole.FRANCHISE_OWNER) {
        const franchise = await db.query.franchises.findFirst({
            where: eq(franchises.ownerId, user.userId)
        });
        if (franchise) {
            whereConditions.push(eq(serviceRequests.franchiseId, franchise.id));
        } else {
            // Franchise owner without a franchise cannot see anything
            return { serviceRequests: [], pagination: { page, limit, total: 0, totalPages: 0 } };
        }
    }
    // ADMIN can see all

    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    const requests = await db.query.serviceRequests.findMany({
        where: whereClause,
        with: {
            customer: { columns: { name: true, phoneNumber: true } },
            franchise: { columns: { name: true } },
            product: { columns: { name: true } },
            assignedTo: { columns: { name: true } } // To show assigned technician name if any (though we are filtering for unassigned)
        },
        orderBy: [desc(serviceRequests.createdAt)],
        limit,
        offset
    });

    // Get total count
    const [{ total }] = await db.select({ total: count() })
        .from(serviceRequests)
        .where(whereClause);

    return {
        serviceRequests: requests,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}


async function assignServiceRequestToSelf(serviceRequestId: string, agentId: string) {
    const fastify = getFastifyInstance();
    const db = fastify.db;

    // Check if the service request exists and is unassigned
    const serviceRequest = await db.query.serviceRequests.findFirst({
        where: and(
            eq(serviceRequests.id, serviceRequestId),
            eq(serviceRequests.assignedToId, null) // Ensure it's unassigned
        ),
        with: { franchise: true, customer: true, product: true }
    });

    if (!serviceRequest) {
        throw notFound('Service request or it is already assigned.');
    }

    // Check if the agent is active in the franchise
    const franchiseAgent = await db.query.franchiseAgents.findFirst({
        where: and(
            eq(franchiseAgents.agentId, agentId),
            eq(franchiseAgents.franchiseId, serviceRequest.franchiseId),
            eq(franchiseAgents.isActive, true)
        )
    });

    if (!franchiseAgent) {
        throw forbidden('You are not an active agent in this franchise.');
    }

    // Assign the service request to the agent
    const [updatedServiceRequest] = await db.update(serviceRequests)
        .set({
            assignedToId: agentId,
            status: ServiceRequestStatus.ASSIGNED, // Assuming 'ASSIGNED' is a valid status
            updatedAt: new Date().toISOString()
        })
        .where(eq(serviceRequests.id, serviceRequestId))
        .returning();

    // Log action history
    await logActionHistory({
        serviceRequestId: serviceRequestId,
        actionType: ActionType.SERVICE_REQUEST_ASSIGNED,
        fromStatus: ServiceRequestStatus.OPEN, // Assuming 'OPEN' was the previous status
        toStatus: ServiceRequestStatus.ASSIGNED,
        performedBy: agentId,
        performedByRole: UserRole.SERVICE_AGENT,
        comment: 'Self-assigned service request',
        metadata: JSON.stringify({ assignedById: agentId })
    });

    // Send push notifications to the assigned agent, previous agent (if any), franchise owner, and admin
    const userPerformingAction = await db.query.users.findFirst({ where: eq(users.id, agentId), columns: { role: true } });
    if (userPerformingAction) {
        await sendServiceRequestNotifications(updatedServiceRequest, 'reassigned', userPerformingAction, serviceRequest.assignedToId); // Pass the previous assignee if available
    }


    return {
        message: 'Service request assigned to you successfully',
        serviceRequest: updatedServiceRequest
    };
}


async function sendServiceRequestNotifications(
    request: any,
    action: 'created' | 'assigned' | 'reassigned' | 'completed' | 'cancelled' | 'scheduled',
    currentUser: { userId: string; role: UserRole },
    previousAgentId?: string // For reassignment notifications
) {
    const fastify = getFastifyInstance();
    const db = fastify.db;

    let title = '';
    let message = '';
    let targetUserIds: string[] = [];
    let targetUserRoles: UserRole[] = [];

    switch (action) {
        case 'created':
            if (request.type !== ServiceRequestType.INSTALLATION) {
                title = 'New Service Request';
                message = `A new service request #${request.id} (${request.type}) has been created for ${request.customerName}.`;
                targetUserRoles = [UserRole.FRANCHISE_OWNER, UserRole.ADMIN];

                const franchiseAgents = await db.query.franchiseAgents.findMany({
                    where: eq(franchiseAgents.franchiseId, request.franchiseId),
                    columns: { agentId: true },
                });
                targetUserIds.push(...franchiseAgents.map(agent => agent.agentId));
            } else {
                // Installation requests are handled by sendInstallationRequestNotifications
                return;
            }
            break;
        case 'assigned':
        case 'reassigned':
            title = 'Service Request Assigned';
            message = `Service request #${request.id} (${request.type}) has been ${action === 'reassigned' ? 'reassigned' : 'assigned'} to you.`;
            if (request.assignedToId) targetUserIds.push(request.assignedToId);
            targetUserRoles = [UserRole.FRANCHISE_OWNER, UserRole.ADMIN];

            if (action === 'reassigned' && previousAgentId) {
                // Notify the previous agent
                const previousAgent = await db.query.users.findFirst({
                    where: eq(users.id, previousAgentId),
                    columns: { pushNotificationToken: true }
                });
                if (previousAgent && previousAgent.pushNotificationToken) {
                    await notificationService.sendPushNotification({
                        title: 'Service Request Reassigned',
                        message: `Service request #${request.id} (${request.type}) has been reassigned from you.`,
                        registrationTokens: [previousAgent.pushNotificationToken],
                        data: { screen: `/service-requests/${request.id}` }
                    });
                }
            }
            break;
        case 'completed':
            title = 'Service Request Completed';
            message = `Service request #${request.id} (${request.type}) has been completed.`;
            targetUserRoles = [UserRole.FRANCHISE_OWNER, UserRole.ADMIN];
            if (request.customerId) targetUserIds.push(request.customerId);
            if (request.assignedToId) targetUserIds.push(request.assignedToId);
            break;
        case 'cancelled':
            title = 'Service Request Cancelled';
            message = `Service request #${request.id} (${request.type}) has been cancelled.`;
            targetUserRoles = [UserRole.FRANCHISE_OWNER, UserRole.ADMIN];
            if (request.customerId) targetUserIds.push(request.customerId);
            if (request.assignedToId) targetUserIds.push(request.assignedToId);
            break;
        case 'scheduled':
            title = 'Service Request Scheduled';
            message = `Service request #${request.id} (${request.type}) has been scheduled for ${request.scheduledDate}.`;
            targetUserRoles = [UserRole.FRANCHISE_OWNER, UserRole.ADMIN];
            if (request.customerId) targetUserIds.push(request.customerId);
            if (request.assignedToId) targetUserIds.push(request.assignedToId);
            break;
        default:
            return;
    }

    let usersToNotify: any[] = [];

    if (targetUserRoles.length > 0) {
        const roleBasedUsers = await db.query.users.findMany({
            where: or(...targetUserRoles.map(role => eq(users.role, role))),
            columns: { id: true, pushNotificationToken: true }
        });
        usersToNotify.push(...roleBasedUsers);
    }

    if (targetUserIds.length > 0) {
        const specificUsers = await db.query.users.findMany({
            where: or(...targetUserIds.map(id => eq(users.id, id))),
            columns: { id: true, pushNotificationToken: true }
        });
        const existingUserIds = new Set(usersToNotify.map(u => u.id));
        specificUsers.forEach(user => {
            if (!existingUserIds.has(user.id)) {
                usersToNotify.push(user);
            }
        });
    }

    const finalUsersToNotify = usersToNotify.filter(user => user.id !== currentUser.userId && user.pushNotificationToken);

    if (finalUsersToNotify.length > 0) {
        await notificationService.sendPushNotification({
            title,
            message,
            registrationTokens: finalUsersToNotify.map(user => user.pushNotificationToken),
            data: {
                screen: `/service-requests/${request.id}` // Example screen navigation
            }
        });
    }
}