// controllers/franchiseagent.controller.ts
import { FastifyReply, FastifyRequest } from "fastify";
import { z } from 'zod';
import { handleError } from "../utils/errors";

import {
    assignAgentToFranchises,
    removeAgentFromFranchise,
    updateFranchiseAssignment,
    getAgentFranchises,
    getFranchiseAgents
} from "../services/franchise-agent.service";
import { serviceAgentAddBody } from "../schemas/serviceagent.schema";
import { getAllServiceAgentsFromDB, serviceAgentAddToDB, serviceAgentUpdateInDB, getAgentDashboard } from "../services/serviceagent.service";



export const getAllServiceAgents = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
        // Extract query parameters properly
        const queryParams = request.query as {
            id?: string;
            franchiseId?: string;
            city?: string;
            isActive?: string;
        };

        // Convert isActive string to boolean if provided
        const filters = {
            id: queryParams.id,
            franchiseId: queryParams.franchiseId,
            city: queryParams.city,
            isActive: queryParams.isActive !== undefined ? queryParams.isActive === 'true' : undefined
        };

        const result = await getAllServiceAgentsFromDB(filters);
        console.log('data is ', result);
        return reply.code(200).send(result);

    } catch (error) {
        return handleError(error, request, reply);
    }
};

export const updateServiceAgent = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
        const { id } = request.params

        await serviceAgentUpdateInDB(id, request.body)

    } catch (error) {
        return handleError(error, request, reply)
    }
}

export const addServiceAgent = async (request: FastifyRequest, reply: FastifyReply) => {


    try {
        await serviceAgentAddToDB(request.body as z.infer<typeof serviceAgentAddBody>)
        return reply.send(200)
    } catch (error) {
        return handleError(error, request, reply)
    }

}

export const assignAgentToFranchisesController = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
        const data = request.body as z.infer<typeof assignAgentBody>;
        const result = await assignAgentToFranchises(data.agentId, data.assignments);

        return reply.code(201).send({
            success: true,
            message: "Agent assigned to franchises successfully",
            data: result
        });
    } catch (error) {
        return handleError(error, request, reply);
    }
};

export const removeAgentFromFranchiseController = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
        const { agentId, franchiseId } = request.params as { agentId: string; franchiseId: string };
        await removeAgentFromFranchise(agentId, franchiseId);

        return reply.code(200).send({
            success: true,
            message: "Agent removed from franchise successfully"
        });
    } catch (error) {
        return handleError(error, request, reply);
    }
};

export const updateFranchiseAssignmentController = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
        const { agentId, franchiseId } = request.params as { agentId: string; franchiseId: string };
        const updateData = request.body as z.infer<typeof updateAssignmentBody>;

        await updateFranchiseAssignment(agentId, franchiseId, updateData);

        return reply.code(200).send({
            success: true,
            message: "Franchise assignment updated successfully"
        });
    } catch (error) {
        return handleError(error, request, reply);
    }
};

export const getAgentFranchisesController = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
        const { agentId } = request.params as { agentId: string };
        const franchises = await getAgentFranchises(agentId);

        return reply.code(200).send(franchises);
    } catch (error) {
        return handleError(error, request, reply);
    }
};

export const getFranchiseAgentsController = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
        const { franchiseId } = request.params as { franchiseId: string };
        const agents = await getFranchiseAgents(franchiseId);
        console.log('avilable agents are ',agents)
        return reply.code(200).send(agents);
    } catch (error) {
        return handleError(error, request, reply);
    }
};

export const getAgentDashboardController = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
        const { agentId } = request.params as { agentId: string };
        const dashboard = await getAgentDashboard(agentId);
        
        return reply.code(200).send({
            success: true,
            data: dashboard
        });
    } catch (error) {
        return handleError(error, request, reply);
    }
};