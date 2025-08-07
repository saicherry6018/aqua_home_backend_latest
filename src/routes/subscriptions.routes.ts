import { FastifyInstance } from 'fastify';
import {
  createSubscription,
  checkSubscription,
  getAllSubscriptions,
  getSubscriptionById,
  updateSubscription,
  pauseSubscription,
  resumeSubscription,
  terminateSubscription,
} from '../controllers/subscriptions.controller';
import {
  createSubscriptionSchema,
  checkSubscriptionSchema,
  getAllSubscriptionsSchema,
  getSubscriptionByIdSchema,
  updateSubscriptionSchema,
  pauseSubscriptionSchema,
  resumeSubscriptionSchema,
  terminateSubscriptionSchema,
} from '../schemas/subscriptions.schema';
import { UserRole } from '../types';

export default async function (fastify: FastifyInstance) {
  // Create a new subscription (admin, franchise owner only)
  fastify.post(
    '/',
    {
      schema: createSubscriptionSchema,
      preHandler: [fastify.authenticate, fastify.authorizeRoles([UserRole.ADMIN, UserRole.FRANCHISE_OWNER])],
    },
    (request, reply) => createSubscription(request as any, reply as any)
  );

  // Check subscription by connect ID (public endpoint)
  fastify.post(
    '/check',
    {
      // schema: checkSubscriptionSchema,
    },
    (request, reply) => checkSubscription(request as any, reply as any)
  );

  // Get all subscriptions (admin, franchise owner, customer)
  fastify.get(
    '/',
    {
      schema: getAllSubscriptionsSchema,
      preHandler: [fastify.authenticate],
    },
    (request, reply) => getAllSubscriptions(request as any, reply as any)
  );

  // Get subscription by ID
  fastify.get(
    '/:id',
    {
      schema: getSubscriptionByIdSchema,
      preHandler: [fastify.authenticate],
    },
    (request, reply) => getSubscriptionById(request as any, reply as any)
  );

  // Update subscription (admin, franchise owner only)
  fastify.patch(
    '/:id',
    {
      schema: updateSubscriptionSchema,
      preHandler: [fastify.authenticate, fastify.authorizeRoles([UserRole.ADMIN, UserRole.FRANCHISE_OWNER])],
    },
    (request, reply) => updateSubscription(request as any, reply as any)
  );

  // Pause subscription (admin, franchise owner only)
  fastify.patch(
    '/:id/pause',
    {
      schema: pauseSubscriptionSchema,
      preHandler: [fastify.authenticate, fastify.authorizeRoles([UserRole.ADMIN, UserRole.FRANCHISE_OWNER])],
    },
    (request, reply) => pauseSubscription(request as any, reply as any)
  );

  // Resume subscription (admin, franchise owner only)
  fastify.patch(
    '/:id/resume',
    {
      schema: resumeSubscriptionSchema,
      preHandler: [fastify.authenticate, fastify.authorizeRoles([UserRole.ADMIN, UserRole.FRANCHISE_OWNER])],
    },
    (request, reply) => resumeSubscription(request as any, reply as any)
  );

  // Terminate subscription (admin, franchise owner only)
  fastify.patch(
    '/:id/terminate',
    {
      schema: terminateSubscriptionSchema,
      preHandler: [fastify.authenticate, fastify.authorizeRoles([UserRole.ADMIN, UserRole.FRANCHISE_OWNER])],
    },
    (request, reply) => terminateSubscription(request as any, reply as any)
  );

  // Generate payment link for subscription
  fastify.post(
    '/:id/generate-payment-link',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' }
          },
          required: ['id']
        },
        response: {
          200: {
            type: 'object',
            properties: {
              paymentId: { type: 'string' },
              razorpayOrderId: { type: 'string' },
              amount: { type: 'number' },
              currency: { type: 'string' },
              key: { type: 'string' },
              message: { type: 'string' }
            }
          }
        },
        tags: ['subscriptions'],
        summary: 'Generate payment link for subscription',
        description: 'Generate a Razorpay payment link for subscription payment'
      }
    },
    (request, reply) => generateSubscriptionPaymentLink(request as any, reply as any)
  );

  // Refresh payment status for subscription
  fastify.post(
    '/:id/refresh-payment-status',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' }
          },
          required: ['id']
        },
        response: {
          200: {
            type: 'object',
            properties: {
              paymentStatus: { type: 'string' },
              message: { type: 'string' },
              payment: { type: 'object' },
              nextPaymentDate: { type: 'string' }
            }
          }
        },
        tags: ['subscriptions'],
        summary: 'Refresh payment status for subscription',
        description: 'Check and refresh payment status from Razorpay'
      }
    },
    (request, reply) => refreshSubscriptionPaymentStatus(request as any, reply as any)
  );

  // Mark payment as completed manually (for cash/UPI payments)
  fastify.post(
    '/:id/mark-payment-completed',
    {
      preHandler: [fastify.authenticate, fastify.authorizeRoles([UserRole.SERVICE_AGENT, UserRole.FRANCHISE_OWNER, UserRole.ADMIN])],
      schema: {
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' }
          },
          required: ['id']
        },
        body: {
          type: 'object',
          properties: {
            paymentMethod: { type: 'string', enum: ['CASH', 'UPI'] },
            paymentImage: { type: 'string' },
            notes: { type: 'string' }
          },
          required: ['paymentMethod']
        },
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              payment: { type: 'object' },
              nextPaymentDate: { type: 'string' }
            }
          }
        },
        tags: ['subscriptions'],
        summary: 'Mark subscription payment as completed',
        description: 'Manually mark subscription payment as completed (for cash/UPI payments)'
      }
    },
    (request, reply) => markSubscriptionPaymentCompleted(request as any, reply as any)
  );

  fastify.log.info('Subscription routes registered');
}