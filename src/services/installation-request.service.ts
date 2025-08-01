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
    serviceRequests
} from '../models/schema';
import {
    InstallationRequestStatus,
    UserRole,
    ActionType,
    PaymentType,
    PaymentStatus,
    ServiceRequestType
} from '../types';
import { badRequest, forbidden, notFound } from '../utils/errors';
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
    }
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
        actionType: ActionType.INSTALLATION_REQUEST_SUBMITTED,
        toStatus: InstallationRequestStatus.SUBMITTED,
        performedBy: customerId,
        performedByRole: UserRole.CUSTOMER,
        comment: `Installation request submitted for ${product.name}`
    });

    // TO-DO
    // await notificationService.notifyInstallationRequest(requestId, franchise.id);

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

    console.log('requests here ',requests);

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
        with: { product: true, customer: true, franchise: true }
    });

    if (!request) {
        throw notFound('Installation request');
    }

    if (request.customerId !== user.userId && user.role !== UserRole.ADMIN) {
        throw forbidden('You can only view your own requests');
    }

    const returnValue = await db.query.installationRequests.findFirst({
        where: eq(installationRequests.id, requestId),
        with: {
            product: true,
            franchise: true,
            customer: true,
            assignedTechnician: true,
            actionHistory: true
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
            razorpayOrderId: request.razorpayOrderId
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
        installationImages?: string[];
        autoPayment?: boolean;
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

    // Validate status transitions
    const validTransitions = getValidStatusTransitions(request.status);
    if (!validTransitions.includes(data.status)) {
        throw badRequest(`Cannot transition from ${request.status} to ${data.status}`);
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
    }

    if (data.status === InstallationRequestStatus.REJECTED && data.rejectionReason) {
        updateData.rejectionReason = data.rejectionReason;
    }

    // Handle installation completion to payment pending
    if (data.status === InstallationRequestStatus.PAYMENT_PENDING && currentStatus === InstallationRequestStatus.INSTALLATION_IN_PROGRESS) {
        // Auto-generate payment link and setup auto payment if enabled
        if (data.autoPayment) {
            try {
                const amount = request.orderType === 'RENTAL' ? request.product.deposit : request.product.buyPrice;
                
                // Create Razorpay order
                const razorpayOrder = await fastify.razorpay.orders.create({
                    amount: amount * 100,
                    currency: 'INR',
                    notes: {
                        type: request.orderType === 'RENTAL' ? 'deposit' : 'purchase',
                        installationRequestId: requestId,
                        customerId: request.customerId,
                    }
                });

                updateData.razorpayOrderId = razorpayOrder.id;

                // For rental orders, create auto-pay subscription after deposit
                if (request.orderType === 'RENTAL') {
                    // This will be handled in payment completion
                    updateData.autoPaymentEnabled = true;
                }
            } catch (error) {
                console.error('Failed to create payment order:', error);
            }
        }
    }

    // Update request
    const [updatedRequest] = await db.update(installationRequests)
        .set(updateData)
        .where(eq(installationRequests.id, requestId)).returning();

    // Handle service request status sync
    const relatedServiceRequest = await db.query.serviceRequests.findFirst({
        where: and(
            eq(serviceRequests.installationRequestId, requestId),
            eq(serviceRequests.type, 'INSTALLATION')
        )
    });

    if (relatedServiceRequest) {
        let serviceRequestStatus: string | null = null;
        let serviceRequestActionType: ActionType | null = null;

        switch (data.status) {
            case InstallationRequestStatus.FRANCHISE_CONTACTED:
                serviceRequestStatus = 'ASSIGNED';
                serviceRequestActionType = ActionType.SERVICE_REQUEST_ASSIGNED;
                break;
            case InstallationRequestStatus.INSTALLATION_SCHEDULED:
                serviceRequestStatus = 'SCHEDULED';
                serviceRequestActionType = ActionType.SERVICE_REQUEST_SCHEDULED;
                break;
            case InstallationRequestStatus.INSTALLATION_IN_PROGRESS:
                serviceRequestStatus = 'IN_PROGRESS';
                serviceRequestActionType = ActionType.SERVICE_REQUEST_IN_PROGRESS;
                break;
            case InstallationRequestStatus.PAYMENT_PENDING:
                serviceRequestStatus = 'PAYMENT_PENDING';
                serviceRequestActionType = ActionType.SERVICE_REQUEST_COMPLETED;
                break;
            case InstallationRequestStatus.INSTALLATION_COMPLETED:
                serviceRequestStatus = 'COMPLETED';
                serviceRequestActionType = ActionType.SERVICE_REQUEST_COMPLETED;
                break;
            case InstallationRequestStatus.CANCELLED:
                serviceRequestStatus = 'CANCELLED';
                serviceRequestActionType = ActionType.SERVICE_REQUEST_CANCELLED;
                break;
            case InstallationRequestStatus.REJECTED:
                serviceRequestStatus = 'CANCELLED';
                serviceRequestActionType = ActionType.SERVICE_REQUEST_CANCELLED;
                break;
        }

        if (serviceRequestStatus && serviceRequestActionType) {
            await db.update(serviceRequests).set({
                status: serviceRequestStatus,
                updatedAt: now,
                ...(serviceRequestStatus === 'COMPLETED' && { completedDate: now })
            }).where(eq(serviceRequests.id, relatedServiceRequest.id));

            await logActionHistory({
                serviceRequestId: relatedServiceRequest.id,
                actionType: serviceRequestActionType,
                fromStatus: relatedServiceRequest.status,
                toStatus: serviceRequestStatus,
                performedBy: user.userId,
                performedByRole: user.role,
                comment: `Service request synced with installation request ${data.status}`,
                metadata: JSON.stringify({ installationRequestId: requestId })
            });
        }
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
            rejectionReason: data.rejectionReason,
            installationImages: data.installationImages,
            autoPayment: data.autoPayment
        })
    });

    return {
        message: `Installation request ${data.status.toLowerCase()} successfully`,
        installationRequest: updatedRequest
    };
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

    if (request.status !== InstallationRequestStatus.PAYMENT_PENDING) {
        throw badRequest('Installation must be in payment pending state to generate payment link');
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
        // Create Razorpay order
        const razorpayOrder = await fastify.razorpay.orders.create({
            amount: amount * 100, // Amount in paise
            currency: 'INR',
            notes: {
                type: request.orderType === 'RENTAL' ? 'deposit' : 'purchase',
                installationRequestId: requestId,
                customerId: request.customerId,
            }
        });

        // Update installation request with payment order ID
        await db.update(installationRequests)
            .set({
                razorpayOrderId: razorpayOrder.id,
                updatedAt: new Date().toISOString()
            })
            .where(eq(installationRequests.id, requestId));

        // Log action history
        await logActionHistory({
            installationRequestId: requestId,
            actionType: ActionType.PAYMENT_LINK_GENERATED,
            performedBy: user.userId,
            performedByRole: user.role,
            comment: 'Payment link generated',
            metadata: JSON.stringify({
                razorpayOrderId: razorpayOrder.id,
                amount: amount
            })
        });

        return {
            message: 'Payment link generated successfully',
            paymentLink: {
                orderId: razorpayOrder.id,
                amount: amount,
                currency: 'INR',
                keyId: process.env.RAZORPAY_KEY_ID,
                qrCodeData: `upi://pay?pa=merchant@upi&pn=Merchant&am=${amount}&cu=INR&tn=${encodeURIComponent(`Payment for ${request.product.name}`)}`
            }
        };
    } catch (error) {
        console.error('Failed to create Razorpay order:', error);
        throw badRequest('Failed to generate payment link');
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

    if (request.status !== InstallationRequestStatus.PAYMENT_PENDING) {
        throw badRequest('Installation must be in payment pending state');
    }

    if (!request.razorpayOrderId) {
        throw badRequest('No payment order found for this request');
    }

    try {
        const payments = await fastify.razorpay.orders.fetchPayments(request.razorpayOrderId);
        const successfulPayment = payments.items.find((payment: any) => payment.status === 'captured');
        
        if (successfulPayment) {
            // Payment found, complete the installation
            await completeInstallationWithPayment(requestId, {
                razorpayPaymentId: successfulPayment.id,
                method: 'RAZORPAY',
                amount: successfulPayment.amount / 100
            }, user);

            return {
                message: 'Payment verified and installation completed',
                paymentStatus: 'COMPLETED',
                paymentDetails: {
                    method: 'RAZORPAY',
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
        console.error('Error checking payment status:', error);
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