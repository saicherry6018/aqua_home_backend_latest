import { FastifyInstance } from "fastify";
import {
    assignAgentToFranchisesController,
    removeAgentFromFranchiseController,
    updateFranchiseAssignmentController,
    getAgentFranchisesController,
    getFranchiseAgentsController,
    addServiceAgent,
    getAllServiceAgents,
    updateServiceAgent
} from "../controllers/serviceagent.controller";
import {
    assignAgentSchema,
    removeAgentSchema,
    updateAssignmentSchema,
    getAgentFranchisesSchema,
    getFranchiseAgentsSchema,
    addServiceAgentSchema,
    getServcieAgentsSchema
} from "../schemas/serviceagent.schema";

export default async function (fastify: FastifyInstance) {
    // Assign agent to franchises
    fastify.post("/assign", { schema: assignAgentSchema }, async (request, reply) =>
        await assignAgentToFranchisesController(request, reply));

    // Remove agent from franchise
    fastify.delete("/:agentId/franchise/:franchiseId", { schema: removeAgentSchema }, async (request, reply) =>
        await removeAgentFromFranchiseController(request, reply));

    // Update franchise assignment
    fastify.patch("/:agentId/franchise/:franchiseId", { schema: updateAssignmentSchema }, async (request, reply) =>
        await updateFranchiseAssignmentController(request, reply));

    // Get all franchises for an agent
    fastify.get("/agent/:agentId/franchises", { schema: getAgentFranchisesSchema }, async (request, reply) =>
        await getAgentFranchisesController(request, reply));

    // Get all agents for a franchise
    fastify.get("/franchise/:franchiseId/agents", { schema: getFranchiseAgentsSchema }, async (request, reply) =>
        await getFranchiseAgentsController(request, reply));

    fastify.post("/", { schema: addServiceAgentSchema }, async (request, reply) => await addServiceAgent(request, reply))
    
    fastify.get("/", { schema: getServcieAgentsSchema }, async (request, reply) => await getAllServiceAgents(request, reply))

    fastify.patch("/:id", { schema: getServcieAgentsSchema }, async (request, reply) => await updateServiceAgent(request, reply))
}