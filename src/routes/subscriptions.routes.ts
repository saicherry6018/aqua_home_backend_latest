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

  fastify.log.info('Subscription routes registered');
}