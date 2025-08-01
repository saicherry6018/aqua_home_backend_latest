
import { FastifyRequest, FastifyReply } from "fastify";
import * as installationRequestService from '../services/installation-request.service';
import { handleError, forbidden, notFound } from "../utils/errors";
import { UserRole, InstallationRequestStatus } from '../types';

interface CreateInstallationRequestBody {
    productId: string;
    orderType: 'RENTAL' | 'PURCHASE';
    name: string;
    phoneNumber: string;
    franchiseId: string;
    installationLatitude: string;
    installationLongitude: string;
    installationAddress: string;
}
interface UpdateStatusBody {
    status: InstallationRequestStatus;
    comment?: string;
    assignedTechnicianId?: string;
    scheduledDate?: string;
    rejectionReason?: string;
    installationImages?: string[];
    autoPayment?: boolean;
}

export async function createInstallationRequest(
    request: FastifyRequest<{ Body: CreateInstallationRequestBody }>,
    reply: FastifyReply
) {
    try {
        // Only customers can create installation requests
        if (request.user.role !== UserRole.CUSTOMER) {
            throw forbidden('Only customers can create installation requests');
        }

        const result = await installationRequestService.createInstallationRequest(
            request.user.userId,
            request.body
        );

        return reply.code(201).send(result);
    } catch (error) {
        handleError(error, request, reply);
    }
}

export async function getInstallationRequests(
    request: FastifyRequest<{
        Querystring: {
            status?: string;
            franchiseId?: string;
            customerId?: string;
            orderType?: 'RENTAL' | 'PURCHASE';
            page?: number;
            limit?: number;
        }
    }>,
    reply: FastifyReply
) {
    try {
        const result = await installationRequestService.getInstallationRequests(
            request.user,
            request.query
        );

        return reply.code(200).send(result);
    } catch (error) {
        handleError(error, request, reply);
    }
}


export async function getInstallationRequestById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
) {
    try {
        const result = await installationRequestService.getInstallationRequestById(
            request.params.id,
            request.user
        );

        if (!result) {
            throw notFound('Installation request');
        }

        return reply.code(200).send({ installationRequest: result });
    } catch (error) {
        handleError(error, request, reply);
    }
}

export async function updateInstallationRequestStatus(
    request: FastifyRequest<{
        Params: { id: string };
        Body: UpdateStatusBody;
    }>,
    reply: FastifyReply
) {
    try {
        const result = await installationRequestService.updateInstallationRequestStatus(
            request.params.id,
            request.body,
            request.user
        );

        return reply.code(200).send(result);
    } catch (error) {
        handleError(error, request, reply);
    }
}
