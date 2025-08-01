
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
    }
}

export async function generatePaymentLink(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
) {
    try {
        const result = await installationRequestService.generatePaymentLink(
            request.params.id,
            request.user
        );

        return reply.code(200).send(result);
    } catch (error) {
        handleError(error, request, reply);
    }
}

export async function markInstallationComplete(
    request: FastifyRequest<{
        Params: { id: string };
        Body: {
            installationImages?: string[];
            notes?: string;
            autoPayment?: boolean;
        };
    }>,
    reply: FastifyReply
) {
    try {
        const result = await installationRequestService.updateInstallationRequestStatus(
            request.params.id,
            {
                status: InstallationRequestStatus.PAYMENT_PENDING,
                comment: request.body.notes,
                installationImages: request.body.installationImages,
                autoPayment: request.body.autoPayment
            },
            request.user
        );

        return reply.code(200).send(result);
    } catch (error) {
        handleError(error, request, reply);
    }
}

export async function verifyPaymentAndComplete(
    request: FastifyRequest<{
        Params: { id: string };
        Body: {
            paymentMethod?: 'RAZORPAY' | 'CASH' | 'UPI';
            paymentImage?: string;
            razorpayPaymentId?: string;
            refresh?: boolean;
        };
    }>,
    reply: FastifyReply
) {
    try {
        const result = await installationRequestService.verifyPaymentAndComplete(
            request.params.id,
            request.body,
            request.user
        );

        return reply.code(200).send(result);
    } catch (error) {
        handleError(error, request, reply);
    }
}
