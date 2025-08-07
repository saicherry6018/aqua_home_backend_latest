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
    
    
}

async function handleRecurringPayment(fastify: FastifyInstance, payload: any) {
    const payment = payload.payment.entity;
    const subscription = payload.subscription.entity;
    
    fastify.log.info(`Recurring payment successful: ${payment.id} for subscription: ${subscription.id}`);
    
   
}

async function handleSubscriptionPaused(fastify: FastifyInstance, payload: any) {
    const subscription = payload.subscription.entity;
    
    fastify.log.info(`Subscription paused: ${subscription.id}`);
    
    
}

async function handleSubscriptionCancelled(fastify: FastifyInstance, payload: any) {
    const subscription = payload.subscription.entity;
    
    fastify.log.info(`Subscription cancelled: ${subscription.id}`);
    
    
}

async function handleSubscriptionCompleted(fastify: FastifyInstance, payload: any) {
    const subscription = payload.subscription.entity;
    
    fastify.log.info(`Subscription completed: ${subscription.id}`);
    
   
}

async function handleSubscriptionUpdated(fastify: FastifyInstance, payload: any) {
    const subscription = payload.subscription.entity;
    
    fastify.log.info(`Subscription updated: ${subscription.id}`);
    
   
}

async function handlePaymentFailed(fastify: FastifyInstance, payload: any) {
    const payment = payload.payment.entity;
    const subscription = payload.subscription?.entity;
    
    fastify.log.error(`Payment failed: ${payment.id}${subscription ? ` for subscription: ${subscription.id}` : ''}`);
    
   
}