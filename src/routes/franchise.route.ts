import { FastifyInstance } from 'fastify';
import {
  getAllFranchiseAreas,
  getFranchiseAreaById,
  createFranchiseArea,
  updateFranchiseArea,
  assignFranchiseOwner,
  assignServiceAgent,
  getServiceAgents,
} from '../controllers/franchise.controller'
import {
  getAllFranchiseAreasSchema,
  getFranchiseAreaByIdSchema,
  createFranchiseAreaSchema,
  updateFranchiseAreaSchema,
  assignFranchiseOwnerSchema,
  assignServiceAgentSchema,
  getServiceAgentsSchema,
} from '../schemas/franchise.schema';
import { UserRole } from '../types';

export default async function (fastify: FastifyInstance) {
  // Get all franchise areas
  fastify.get(
    '/',
    {
      schema: getAllFranchiseAreasSchema,
      // preHandler: [fastify.authenticate],
    },
    (request, reply) => getAllFranchiseAreas(request as any, reply as any)
  );

  // Get franchise area by ID
  fastify.get(
    '/:id',
    {
      schema: getFranchiseAreaByIdSchema,
      // preHandler: [fastify.authenticate],
    },
    (request, reply) => getFranchiseAreaById(request as any, reply as any)
  );

  // Create a new franchise area (admin only)
  fastify.post(
    '/',
    {
      schema: createFranchiseAreaSchema,
      preHandler: [fastify.authenticate, fastify.authorizeRoles([UserRole.ADMIN])],
    },
    (request,reply)=>createFranchiseArea(request as any,reply as any)
  );

  // Update franchise area (admin only)
  fastify.patch(
    '/:id',
    {
      schema: updateFranchiseAreaSchema,
      preHandler: [fastify.authorizeRoles([UserRole.ADMIN])],
    },
    (request, reply) => updateFranchiseArea(request as any, reply as any)
  );

  // Assign franchise owner (admin only)
  fastify.patch(
    '/:id/assign-owner',
    {
      schema: assignFranchiseOwnerSchema,
      preHandler: [fastify.authorizeRoles([UserRole.ADMIN])],
    },
    (request, reply) => assignFranchiseOwner(request as any, reply as any)
  );

  // Assign service agent (admin or franchise owner)
  fastify.patch(
    '/:id/assign-agent',
    {
      schema: assignServiceAgentSchema,
      preHandler: [fastify.authorizeRoles([UserRole.ADMIN, UserRole.FRANCHISE_OWNER])],
    },
    (request, reply) => assignServiceAgent(request as any, reply as any)
  );

  // Get all service agents for a franchise area
  fastify.get(
    '/:id/agents',
    {
      schema: getServiceAgentsSchema,
      preHandler: [fastify.authenticate],
    },
    (request, reply) => getServiceAgents(request as any, reply as any)
  );

  fastify.log.info('Franchise routes registered');
} 