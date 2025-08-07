import { FastifyInstance } from 'fastify';
import crypto from 'crypto';

export default async function webhookRoutes(fastify: FastifyInstance) {
    // Webhook signature verification middleware
    const verifyWebhookSignature = async (request: any, reply: any) => {
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        
        if (!webhookSecret) {
            fastify.log.error('RAZORPAY_WEBHOOK_SECRET not configured');
            return reply.status(500).send({ error: 'Webhook secret not configured' });
        }

        const receivedSignature = request.headers['x-razorpay-signature'];
        
        if (!receivedSignature) {
            fastify.log.error('No signature header found');
            return reply.status(400).send({ error: 'No signature header' });
        }

        // Get raw body for signature verification
        const body = JSON.stringify(request.body);
        const expectedSignature = crypto
            .createHmac('sha256', webhookSecret)
            .update(body)
            .digest('hex');

        if (receivedSignature !== expectedSignature) {
            fastify.log.error('Invalid webhook signature');
            return reply.status(400).send({ error: 'Invalid signature' });
        }
    };

    // Main webhook endpoint
    fastify.post('/razorpay', {
        preHandler: verifyWebhookSignature,
        schema: {
            description: 'Razorpay webhook endpoint',
            tags: ['webhooks'],
            body: {
                type: 'object',
                properties: {
                    event: { type: 'string' },
                    payload: { type: 'object' }
                }
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        status: { type: 'string' },
                        message: { type: 'string' }
                    }
                }
            }
        }
    }, async (request, reply) => {
        const { event, payload } = request.body as any;
        
        fastify.log.info(`Received webhook event: ${event}`);

        try {
            switch (event) {
                case 'subscription.activated':
                    await handleSubscriptionActivated(fastify, payload);
                    break;

                case 'subscription.charged':
                    await handleRecurringPayment(fastify, payload);
                    break;

                case 'subscription.paused':
                    await handleSubscriptionPaused(fastify, payload);
                    break;

                case 'subscription.cancelled':
                    await handleSubscriptionCancelled(fastify, payload);
                    break;

                case 'subscription.completed':
                    await handleSubscriptionCompleted(fastify, payload);
                    break;

                case 'subscription.updated':
                    await handleSubscriptionUpdated(fastify, payload);
                    break;

                case 'payment.failed':
                    await handlePaymentFailed(fastify, payload);
                    break;

                default:
                    fastify.log.warn(`Unhandled webhook event: ${event}`);
            }

            return reply.status(200).send({
                status: 'success',
                message: `Webhook ${event} processed successfully`
            });

        } catch (error) {
            fastify.log.error(`Error processing webhook ${event}:`, error);
            return reply.status(500).send({
                status: 'error',
                message: 'Failed to process webhook'
            });
        }
    });
}

// Handler functions for different webhook events
async function handleSubscriptionActivated(fastify: FastifyInstance, payload: any) {
    const subscription = payload.subscription.entity;
    
    fastify.log.info(`Subscription activated: ${subscription.id}`);
    
    // First cycle is handled manually, just log for now
    // No database updates needed for activation
}

async function handleRecurringPayment(fastify: FastifyInstance, payload: any) {
    const payment = payload.payment.entity;
    const subscription = payload.subscription.entity;
    
    fastify.log.info(`Recurring payment successful: ${payment.id} for subscription: ${subscription.id}`);
    
    try {
        const { eq } = await import('drizzle-orm');
        const { subscriptions, payments, users, franchises } = await import('../models/schema');
        const { PaymentStatus, ActionType } = await import('../types');
        const { generateId } = await import('../utils/helpers');
        const { logActionHistory } = await import('../utils/actionHistory');
        const { notificationService } = await import('../services/notification.service');

        // Find subscription by Razorpay subscription ID
        const dbSubscription = await fastify.db.query.subscriptions.findFirst({
            where: eq(subscriptions.razorpaySubscriptionId, subscription.id),
            with: {
                user: {
                    columns: {
                        id: true,
                        name: true,
                        pushToken: true,
                        phone: true
                    }
                },
                franchise: {
                    columns: {
                        id: true,
                        name: true,
                        city: true,
                        ownerId: true
                    }
                }
            }
        });

        if (dbSubscription) {
            // Create payment record for the recurring payment
            const paymentId = await generateId('pay');
            await fastify.db.insert(payments).values({
                id: paymentId,
                userId: dbSubscription.customerId,
                subscriptionId: dbSubscription.id,
                franchiseId: dbSubscription.franchiseId,
                amount: payment.amount / 100, // Convert from paise to rupees
                type: 'SUBSCRIPTION',
                status: PaymentStatus.COMPLETED,
                paymentMethod: 'RAZORPAY_AUTOPAY',
                razorpayPaymentId: payment.id,
                razorpaySubscriptionId: subscription.id,
                paidDate: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            // Update subscription's next payment date
            const nextPaymentDate = new Date();
            nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
            
            await fastify.db.update(subscriptions).set({
                currentPeriodStartDate: new Date().toISOString(),
                currentPeriodEndDate: nextPaymentDate.toISOString(),
                nextPaymentDate: nextPaymentDate.toISOString(),
                updatedAt: new Date().toISOString(),
            }).where(eq(subscriptions.id, dbSubscription.id));

            // Log action history
            await logActionHistory({
                paymentId,
                subscriptionId: dbSubscription.id,
                actionType: ActionType.PAYMENT_COMPLETED,
                toStatus: PaymentStatus.COMPLETED,
                performedBy: 'system',
                performedByRole: 'ADMIN',
                comment: 'Recurring payment processed via Razorpay AutoPay',
                metadata: { 
                    razorpayPaymentId: payment.id,
                    razorpaySubscriptionId: subscription.id,
                    amount: payment.amount / 100
                }
            });

            // Send notifications to customer
            if (dbSubscription.user?.pushToken) {
                try {
                    await notificationService.sendSinglePushNotification({
                        pushToken: dbSubscription.user.pushToken,
                        title: 'Payment Successful',
                        message: `Your monthly payment of ₹${payment.amount / 100} has been processed successfully.`,
                        data: {
                            type: 'payment_success',
                            paymentId,
                            subscriptionId: dbSubscription.id,
                            amount: payment.amount / 100
                        }
                    });
                } catch (notifError) {
                    fastify.log.error('Failed to send notification to customer:', notifError);
                }
            }

            // Send notification to franchise owner
            if (dbSubscription.franchise?.ownerId) {
                const franchiseOwner = await fastify.db.query.users.findFirst({
                    where: eq(users.id, dbSubscription.franchise.ownerId),
                    columns: {
                        pushToken: true,
                        name: true
                    }
                });

                if (franchiseOwner?.pushToken) {
                    try {
                        await notificationService.sendSinglePushNotification({
                            pushToken: franchiseOwner.pushToken,
                            title: 'Payment Received',
                            message: `Payment of ₹${payment.amount / 100} received from ${dbSubscription.user?.name} for ${dbSubscription.franchise?.name}.`,
                            data: {
                                type: 'payment_received',
                                paymentId,
                                subscriptionId: dbSubscription.id,
                                amount: payment.amount / 100,
                                customerName: dbSubscription.user?.name
                            }
                        });
                    } catch (notifError) {
                        fastify.log.error('Failed to send notification to franchise owner:', notifError);
                    }
                }
            }

            // Send notification to admin (you can get admin users and send notifications)
            const admins = await fastify.db.query.users.findMany({
                where: eq(users.role, 'ADMIN'),
                columns: {
                    pushToken: true,
                    name: true
                }
            });

            for (const admin of admins) {
                if (admin.pushToken) {
                    try {
                        await notificationService.sendSinglePushNotification({
                            pushToken: admin.pushToken,
                            title: 'Recurring Payment Processed',
                            message: `Payment of ₹${payment.amount / 100} processed for ${dbSubscription.franchise?.name} - ${dbSubscription.user?.name}`,
                            data: {
                                type: 'admin_payment_notification',
                                paymentId,
                                subscriptionId: dbSubscription.id,
                                amount: payment.amount / 100
                            }
                        });
                    } catch (notifError) {
                        fastify.log.error('Failed to send notification to admin:', notifError);
                    }
                }
            }

            fastify.log.info('Recurring payment processed successfully:', paymentId);
        } else {
            fastify.log.error('Subscription not found for Razorpay subscription ID:', subscription.id);
        }
    } catch (error) {
        fastify.log.error('Error handling recurring payment:', error);
        throw error;
    }
}

async function handleSubscriptionPaused(fastify: FastifyInstance, payload: any) {
    const subscription = payload.subscription.entity;
    
    fastify.log.info(`Subscription paused: ${subscription.id}`);
    
    try {
        const { eq } = await import('drizzle-orm');
        const { subscriptions, users } = await import('../models/schema');
        const { ActionType } = await import('../types');
        const { logActionHistory } = await import('../utils/actionHistory');
        const { notificationService } = await import('../services/notification.service');

        // Find subscription by Razorpay subscription ID
        const dbSubscription = await fastify.db.query.subscriptions.findFirst({
            where: eq(subscriptions.razorpaySubscriptionId, subscription.id),
            with: {
                user: {
                    columns: {
                        id: true,
                        name: true,
                        pushToken: true
                    }
                },
                franchise: {
                    columns: {
                        id: true,
                        name: true,
                        ownerId: true
                    }
                }
            }
        });

        if (dbSubscription) {
            // Update subscription status
            await fastify.db.update(subscriptions).set({
                status: 'PAUSED',
                updatedAt: new Date().toISOString(),
            }).where(eq(subscriptions.id, dbSubscription.id));

            // Log action history
            await logActionHistory({
                subscriptionId: dbSubscription.id,
                actionType: ActionType.SUBSCRIPTION_PAUSED,
                fromStatus: 'ACTIVE',
                toStatus: 'PAUSED',
                performedBy: 'system',
                performedByRole: 'ADMIN',
                comment: 'Subscription paused due to payment failures',
                metadata: { razorpaySubscriptionId: subscription.id }
            });

            // Send notifications to all stakeholders
            const notifications = [];

            // Customer notification
            if (dbSubscription.user?.pushToken) {
                notifications.push(
                    notificationService.sendSinglePushNotification({
                        pushToken: dbSubscription.user.pushToken,
                        title: 'Subscription Paused',
                        message: 'Your subscription has been paused due to payment issues. Please update your payment method.',
                        data: {
                            type: 'subscription_paused',
                            subscriptionId: dbSubscription.id,
                            action: 'update_payment'
                        }
                    })
                );
            }

            // Franchise owner notification
            if (dbSubscription.franchise?.ownerId) {
                const franchiseOwner = await fastify.db.query.users.findFirst({
                    where: eq(users.id, dbSubscription.franchise.ownerId),
                    columns: { pushToken: true }
                });

                if (franchiseOwner?.pushToken) {
                    notifications.push(
                        notificationService.sendSinglePushNotification({
                            pushToken: franchiseOwner.pushToken,
                            title: 'Subscription Paused',
                            message: `Subscription for ${dbSubscription.user?.name} has been paused due to payment failures.`,
                            data: {
                                type: 'subscription_paused',
                                subscriptionId: dbSubscription.id,
                                customerName: dbSubscription.user?.name
                            }
                        })
                    );
                }
            }

            // Admin notifications
            const admins = await fastify.db.query.users.findMany({
                where: eq(users.role, 'ADMIN'),
                columns: { pushToken: true }
            });

            for (const admin of admins) {
                if (admin.pushToken) {
                    notifications.push(
                        notificationService.sendSinglePushNotification({
                            pushToken: admin.pushToken,
                            title: 'Subscription Paused',
                            message: `Subscription ${dbSubscription.id} paused - ${dbSubscription.franchise?.name}`,
                            data: {
                                type: 'admin_subscription_paused',
                                subscriptionId: dbSubscription.id
                            }
                        })
                    );
                }
            }

            // Execute all notifications
            await Promise.allSettled(notifications);
        }
    } catch (error) {
        fastify.log.error('Error handling subscription paused:', error);
        throw error;
    }
}

async function handleSubscriptionCancelled(fastify: FastifyInstance, payload: any) {
    const subscription = payload.subscription.entity;
    
    fastify.log.info(`Subscription cancelled: ${subscription.id}`);
    
    try {
        const { eq } = await import('drizzle-orm');
        const { subscriptions, users } = await import('../models/schema');
        const { ActionType } = await import('../types');
        const { logActionHistory } = await import('../utils/actionHistory');
        const { notificationService } = await import('../services/notification.service');

        // Find subscription by Razorpay subscription ID
        const dbSubscription = await fastify.db.query.subscriptions.findFirst({
            where: eq(subscriptions.razorpaySubscriptionId, subscription.id),
            with: {
                user: {
                    columns: {
                        id: true,
                        name: true,
                        pushToken: true
                    }
                },
                franchise: {
                    columns: {
                        id: true,
                        name: true,
                        ownerId: true
                    }
                }
            }
        });

        if (dbSubscription) {
            // Update subscription status
            await fastify.db.update(subscriptions).set({
                status: 'TERMINATED',
                updatedAt: new Date().toISOString(),
            }).where(eq(subscriptions.id, dbSubscription.id));

            // Log action history
            await logActionHistory({
                subscriptionId: dbSubscription.id,
                actionType: ActionType.SUBSCRIPTION_TERMINATED,
                fromStatus: dbSubscription.status,
                toStatus: 'TERMINATED',
                performedBy: 'system',
                performedByRole: 'ADMIN',
                comment: 'Subscription cancelled via Razorpay',
                metadata: { razorpaySubscriptionId: subscription.id }
            });

            // Send notifications to all stakeholders
            const notifications = [];

            // Customer notification
            if (dbSubscription.user?.pushToken) {
                notifications.push(
                    notificationService.sendSinglePushNotification({
                        pushToken: dbSubscription.user.pushToken,
                        title: 'Subscription Cancelled',
                        message: 'Your subscription has been cancelled. Service will be discontinued.',
                        data: {
                            type: 'subscription_cancelled',
                            subscriptionId: dbSubscription.id
                        }
                    })
                );
            }

            // Franchise owner notification
            if (dbSubscription.franchise?.ownerId) {
                const franchiseOwner = await fastify.db.query.users.findFirst({
                    where: eq(users.id, dbSubscription.franchise.ownerId),
                    columns: { pushToken: true }
                });

                if (franchiseOwner?.pushToken) {
                    notifications.push(
                        notificationService.sendSinglePushNotification({
                            pushToken: franchiseOwner.pushToken,
                            title: 'Subscription Cancelled',
                            message: `Subscription for ${dbSubscription.user?.name} has been cancelled.`,
                            data: {
                                type: 'subscription_cancelled',
                                subscriptionId: dbSubscription.id,
                                customerName: dbSubscription.user?.name
                            }
                        })
                    );
                }
            }

            // Admin notifications
            const admins = await fastify.db.query.users.findMany({
                where: eq(users.role, 'ADMIN'),
                columns: { pushToken: true }
            });

            for (const admin of admins) {
                if (admin.pushToken) {
                    notifications.push(
                        notificationService.sendSinglePushNotification({
                            pushToken: admin.pushToken,
                            title: 'Subscription Cancelled',
                            message: `Subscription ${dbSubscription.id} cancelled - ${dbSubscription.franchise?.name}`,
                            data: {
                                type: 'admin_subscription_cancelled',
                                subscriptionId: dbSubscription.id
                            }
                        })
                    );
                }
            }

            // Execute all notifications
            await Promise.allSettled(notifications);
        }
    } catch (error) {
        fastify.log.error('Error handling subscription cancelled:', error);
        throw error;
    }
}

async function handleSubscriptionCompleted(fastify: FastifyInstance, payload: any) {
    const subscription = payload.subscription.entity;
    
    fastify.log.info(`Subscription completed: ${subscription.id}`);
    
    try {
        const { eq } = await import('drizzle-orm');
        const { subscriptions, users } = await import('../models/schema');
        const { ActionType } = await import('../types');
        const { logActionHistory } = await import('../utils/actionHistory');
        const { notificationService } = await import('../services/notification.service');

        // Find subscription by Razorpay subscription ID
        const dbSubscription = await fastify.db.query.subscriptions.findFirst({
            where: eq(subscriptions.razorpaySubscriptionId, subscription.id),
            with: {
                user: {
                    columns: {
                        id: true,
                        name: true,
                        pushToken: true
                    }
                },
                franchise: {
                    columns: {
                        id: true,
                        name: true,
                        ownerId: true
                    }
                }
            }
        });

        if (dbSubscription) {
            // Update subscription status
            await fastify.db.update(subscriptions).set({
                status: 'EXPIRED',
                updatedAt: new Date().toISOString(),
            }).where(eq(subscriptions.id, dbSubscription.id));

            // Log action history
            await logActionHistory({
                subscriptionId: dbSubscription.id,
                actionType: ActionType.SUBSCRIPTION_EXPIRED,
                fromStatus: dbSubscription.status,
                toStatus: 'EXPIRED',
                performedBy: 'system',
                performedByRole: 'ADMIN',
                comment: 'Subscription completed/expired via Razorpay',
                metadata: { razorpaySubscriptionId: subscription.id }
            });

            // Send notifications to all stakeholders
            const notifications = [];

            // Customer notification
            if (dbSubscription.user?.pushToken) {
                notifications.push(
                    notificationService.sendSinglePushNotification({
                        pushToken: dbSubscription.user.pushToken,
                        title: 'Subscription Completed',
                        message: 'Your subscription term has completed. Thank you for using our service.',
                        data: {
                            type: 'subscription_completed',
                            subscriptionId: dbSubscription.id
                        }
                    })
                );
            }

            // Franchise owner notification
            if (dbSubscription.franchise?.ownerId) {
                const franchiseOwner = await fastify.db.query.users.findFirst({
                    where: eq(users.id, dbSubscription.franchise.ownerId),
                    columns: { pushToken: true }
                });

                if (franchiseOwner?.pushToken) {
                    notifications.push(
                        notificationService.sendSinglePushNotification({
                            pushToken: franchiseOwner.pushToken,
                            title: 'Subscription Completed',
                            message: `Subscription for ${dbSubscription.user?.name} has completed its term.`,
                            data: {
                                type: 'subscription_completed',
                                subscriptionId: dbSubscription.id,
                                customerName: dbSubscription.user?.name
                            }
                        })
                    );
                }
            }

            // Admin notifications
            const admins = await fastify.db.query.users.findMany({
                where: eq(users.role, 'ADMIN'),
                columns: { pushToken: true }
            });

            for (const admin of admins) {
                if (admin.pushToken) {
                    notifications.push(
                        notificationService.sendSinglePushNotification({
                            pushToken: admin.pushToken,
                            title: 'Subscription Completed',
                            message: `Subscription ${dbSubscription.id} completed - ${dbSubscription.franchise?.name}`,
                            data: {
                                type: 'admin_subscription_completed',
                                subscriptionId: dbSubscription.id
                            }
                        })
                    );
                }
            }

            // Execute all notifications
            await Promise.allSettled(notifications);
        }
    } catch (error) {
        fastify.log.error('Error handling subscription completed:', error);
        throw error;
    }
}

async function handleSubscriptionUpdated(fastify: FastifyInstance, payload: any) {
    const subscription = payload.subscription.entity;
    
    fastify.log.info(`Subscription updated: ${subscription.id}`);
    
    // Log the update for audit purposes
    try {
        const { eq } = await import('drizzle-orm');
        const { subscriptions } = await import('../models/schema');
        const { ActionType } = await import('../types');
        const { logActionHistory } = await import('../utils/actionHistory');

        const dbSubscription = await fastify.db.query.subscriptions.findFirst({
            where: eq(subscriptions.razorpaySubscriptionId, subscription.id)
        });

        if (dbSubscription) {
            await logActionHistory({
                subscriptionId: dbSubscription.id,
                actionType: ActionType.SUBSCRIPTION_UPDATED,
                performedBy: 'system',
                performedByRole: 'ADMIN',
                comment: 'Subscription updated via Razorpay webhook',
                metadata: { 
                    razorpaySubscriptionId: subscription.id,
                    updateDetails: subscription
                }
            });
        }
    } catch (error) {
        fastify.log.error('Error logging subscription update:', error);
    }
}

async function handlePaymentFailed(fastify: FastifyInstance, payload: any) {
    const payment = payload.payment.entity;
    const subscription = payload.subscription?.entity;
    
    fastify.log.error(`Payment failed: ${payment.id}${subscription ? ` for subscription: ${subscription.id}` : ''}`);
    
    try {
        const { eq } = await import('drizzle-orm');
        const { subscriptions, payments, users } = await import('../models/schema');
        const { PaymentStatus, ActionType } = await import('../types');
        const { logActionHistory } = await import('../utils/actionHistory');
        const { notificationService } = await import('../services/notification.service');

        // Find subscription if available
        let dbSubscription = null;
        if (subscription) {
            dbSubscription = await fastify.db.query.subscriptions.findFirst({
                where: eq(subscriptions.razorpaySubscriptionId, subscription.id),
                with: {
                    user: {
                        columns: {
                            id: true,
                            name: true,
                            pushToken: true
                        }
                    },
                    franchise: {
                        columns: {
                            id: true,
                            name: true,
                            ownerId: true
                        }
                    }
                }
            });
        }

        // Find payment record if exists
        const dbPayment = await fastify.db.query.payments.findFirst({
            where: eq(payments.razorpayPaymentId, payment.id)
        });

        if (dbPayment) {
            // Update payment status
            await fastify.db.update(payments).set({
                status: PaymentStatus.FAILED,
                updatedAt: new Date().toISOString(),
            }).where(eq(payments.id, dbPayment.id));

            // Log action history
            await logActionHistory({
                paymentId: dbPayment.id,
                subscriptionId: dbPayment.subscriptionId || undefined,
                actionType: ActionType.PAYMENT_FAILED,
                fromStatus: PaymentStatus.PENDING,
                toStatus: PaymentStatus.FAILED,
                performedBy: 'system',
                performedByRole: 'ADMIN',
                comment: 'Payment failed via Razorpay',
                metadata: { 
                    razorpayPaymentId: payment.id,
                    errorCode: payment.error_code,
                    errorDescription: payment.error_description
                }
            });
        }

        // Send notifications
        const notifications = [];

        if (dbSubscription) {
            // Customer notification
            if (dbSubscription.user?.pushToken) {
                notifications.push(
                    notificationService.sendSinglePushNotification({
                        pushToken: dbSubscription.user.pushToken,
                        title: 'Payment Failed',
                        message: 'Your payment could not be processed. Please update your payment method to avoid service disruption.',
                        data: {
                            type: 'payment_failed',
                            subscriptionId: dbSubscription.id,
                            paymentId: payment.id,
                            action: 'update_payment'
                        }
                    })
                );
            }

            // Franchise owner notification
            if (dbSubscription.franchise?.ownerId) {
                const franchiseOwner = await fastify.db.query.users.findFirst({
                    where: eq(users.id, dbSubscription.franchise.ownerId),
                    columns: { pushToken: true }
                });

                if (franchiseOwner?.pushToken) {
                    notifications.push(
                        notificationService.sendSinglePushNotification({
                            pushToken: franchiseOwner.pushToken,
                            title: 'Payment Failed',
                            message: `Payment failed for ${dbSubscription.user?.name}. Customer needs to update payment method.`,
                            data: {
                                type: 'payment_failed',
                                subscriptionId: dbSubscription.id,
                                customerName: dbSubscription.user?.name
                            }
                        })
                    );
                }
            }
        }

        // Execute all notifications
        await Promise.allSettled(notifications);

    } catch (error) {
        fastify.log.error('Error handling payment failed:', error);
        throw error;
    }
}