import { FastifyRequest, FastifyReply } from 'fastify';
import * as franchiseService from '../services/franchise.service';
import { handleError, notFound, forbidden, serverError, badRequest, conflict } from '../utils/errors';


// Get all franchise areas
export async function getAllFranchiseAreas(
  request: FastifyRequest<{ Querystring: any }>,
  reply: FastifyReply
) {
  try {
    const filters = request.query;
    const areas = await franchiseService.getAllFranchiseAreas(filters);
    return reply.code(200).send(areas);
  } catch (error) {
    handleError(error, request, reply);
  }
}

// Get franchise area by ID
export async function getFranchiseAreaById(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const area = await franchiseService.getFranchiseAreaById(id);
    console.log('area ',area)
    if (!area) throw notFound('Franchise Area');
    return reply.code(200).send({ franchiseArea: area });
  } catch (error) {
    handleError(error, request, reply);
  }
}

interface CreateFranchiseAreaBody {
  name: string;
  city: string;
  geoPolygon?: string;
  phoneNumber?: string;
}

// Create a new franchise area
export async function createFranchiseArea(
  request: FastifyRequest<{ Body: CreateFranchiseAreaBody }>,
  reply: FastifyReply
) {
  try {


    const createdFranchiseArea = await franchiseService.createFranchiseArea(request.body);

    // Return the created franchise area
    return reply.status(201).send({
      id: createdFranchiseArea.id,
      name: createdFranchiseArea.name,
      city: createdFranchiseArea.city,
      geoPolygon: createdFranchiseArea.geoPolygon,
      isCompanyManaged: createdFranchiseArea.isCompanyManaged,
    });
  } catch (error) {
    request.server.log.error('Error creating franchise area:', error);
    throw serverError('Failed to create franchise area');
  }
}

// Update franchise area
export async function updateFranchiseArea(
  request: FastifyRequest<{ Params: { id: string }; Body: any }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const area = await franchiseService.updateFranchiseArea(id, request.body);
    return reply.code(200).send({ message: 'Franchise area updated', franchiseArea: area });
  } catch (error) {
    handleError(error, request, reply);
  }
}

// Assign franchise owner
export async function assignFranchiseOwner(
  request: FastifyRequest<{ Params: { id: string }; Body: { ownerId: string } }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const { ownerId } = request.body;
    const area = await franchiseService.assignFranchiseOwner(id, ownerId);
    return reply.code(200).send({ message: 'Franchise owner assigned', franchiseArea: area });
  } catch (error) {
    handleError(error, request, reply);
  }
}

// Assign service agent
export async function assignServiceAgent(
  request: FastifyRequest<{ Params: { id: string }; Body: { agentId: string } }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const { agentId } = request.body;
    const user = request.user;
    const agent = await franchiseService.assignServiceAgent(id, agentId, user);
    return reply.code(200).send({ message: 'Service agent assigned', agent });
  } catch (error) {
    handleError(error, request, reply);
  }
}

// Get all service agents for a franchise area
export async function getServiceAgents(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const agents = await franchiseService.getServiceAgents(id);
    return reply.code(200).send({ agents });
  } catch (error) {
    handleError(error, request, reply);
  }
} 