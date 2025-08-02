
import { getFastifyInstance } from '../shared/fastify-instance';
import { payments, users, franchises, subscriptions } from '../models/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { notFound, forbidden } from '../utils/errors';
import { UserRole } from '../types';

export interface Payment {
    id: string;
    userId: string;
    subscriptionId?: string;
    serviceRequestId?: string;
    amount: number;
    status: 'pending' | 'completed' | 'failed' | 'refunded';
    paymentMethod: string;
    razorpayPaymentId?: string;
    razorpayOrderId?: string;
    franchiseId: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * Get payments based on user role
 */
export async function getPaymentsByRole(user: any) {
    const fastify = getFastifyInstance();
    const db = fastify.db;

    let paymentsQuery;

    switch (user.role) {
        case UserRole.ADMIN:
            // Admin can see all payments
            paymentsQuery = db.query.payments.findMany({
                with: {
                    user: {
                        columns: {
                            id: true,
                            name: true,
                            phone: true,
                        }
                    },
                    subscription: {
                        columns: {
                            id: true,
                            planName: true,
                        }
                    },
                    franchise: {
                        columns: {
                            id: true,
                            name: true,
                            city: true,
                        }
                    }
                }
            });
            break;

        case UserRole.FRANCHISE_OWNER:
            // Get franchise owner's franchise area
            const franchise = await db.query.franchises.findFirst({
                where: eq(franchises.ownerId, user.userId)
            });
            
            if (!franchise) {
                throw notFound('Franchise area not found for this owner');
            }

            // Franchise owner can only see payments from their franchise
            paymentsQuery = db.query.payments.findMany({
                where: eq(payments.franchiseId, franchise.id),
                with: {
                    user: {
                        columns: {
                            id: true,
                            name: true,
                            phone: true,
                        }
                    },
                    subscription: {
                        columns: {
                            id: true,
                            planName: true,
                        }
                    }
                }
            });
            break;

        case UserRole.CUSTOMER:
            // Customer can only see their own payments
            paymentsQuery = db.query.payments.findMany({
                where: eq(payments.userId, user.userId),
                with: {
                    subscription: {
                        columns: {
                            id: true,
                            planName: true,
                        }
                    },
                    franchise: {
                        columns: {
                            id: true,
                            name: true,
                            city: true,
                        }
                    }
                }
            });
            break;

        default:
            throw forbidden('Access denied');
    }

    const results = await paymentsQuery;
    return results;
}

/**
 * Get payment by ID with role-based access control
 */
export async function getPaymentById(paymentId: string, user: any) {
    const fastify = getFastifyInstance();
    const db = fastify.db;

    const payment = await db.query.payments.findFirst({
        where: eq(payments.id, paymentId),
        with: {
            user: {
                columns: {
                    id: true,
                    name: true,
                    phone: true,
                }
            },
            subscription: {
                columns: {
                    id: true,
                    planName: true,
                }
            },
            franchise: {
                columns: {
                    id: true,
                    name: true,
                    city: true,
                }
            }
        }
    });

    if (!payment) {
        throw notFound('Payment');
    }

    // Check access based on role
    switch (user.role) {
        case UserRole.ADMIN:
            // Admin can access any payment
            break;

        case UserRole.FRANCHISE_OWNER:
            // Check if payment belongs to franchise owner's franchise
            const franchise = await db.query.franchises.findFirst({
                where: eq(franchises.ownerId, user.userId)
            });
            
            if (!franchise || payment.franchiseId !== franchise.id) {
                throw forbidden('Access denied to this payment');
            }
            break;

        case UserRole.CUSTOMER:
            // Customer can only access their own payments
            if (payment.userId !== user.userId) {
                throw forbidden('Access denied to this payment');
            }
            break;

        default:
            throw forbidden('Access denied');
    }

    return payment;
}
