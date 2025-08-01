import { FastifyInstance } from "fastify";
import {
    createInstallationRequestSchema,
    getInstallationRequestsSchema,
    updateInstallationRequestStatusSchema,
    completeInstallationSchema
} from "../schemas/installation-request.schema";
import {
    createInstallationRequest,
    getInstallationRequests,
    getInstallationRequestById,
    updateInstallationRequestStatus,
    markInstallationComplete,
    refreshPaymentStatus,
    generatePaymentLink,
    verifyPaymentAndComplete
} from "../controllers/installation-request.controller";
import { UserRole } from "../types";

export default async function (fastify: FastifyInstance) {
    // Customer creates installation request
    fastify.post(
        '/',
        {
            schema: createInstallationRequestSchema,
            preHandler: [fastify.authenticate],
        },
        (req, rep) => createInstallationRequest(req as any, rep)
    );

    // Get installation requests (with role-based filtering)
    fastify.get(
        '/',
        {
            schema: getInstallationRequestsSchema,
            preHandler: [fastify.authenticate],
        },
        (req, rep) => getInstallationRequests(req as any, rep)

    );

    // Get single installation request by ID
    fastify.get(
        '/:id',
        {
            preHandler: [fastify.authenticate],
        },
        (req, rep) => getInstallationRequestById(req as any, rep)

    );

    // Update installation request status (Franchise/Admin only)
    fastify.patch(
        '/:id/status',
        {
            schema: updateInstallationRequestStatusSchema,
            preHandler: [fastify.authenticate, fastify.authorizeRoles([UserRole.FRANCHISE_OWNER, UserRole.ADMIN])],
        },
        (req, rep) => updateInstallationRequestStatus(req as any, rep)

    );

    // Mark installation as complete (moves to payment pending)
    fastify.put('/:id/mark-complete', {
        preHandler: [fastify.authenticate, fastify.authorizeRoles([UserRole.SERVICE_AGENT, UserRole.ADMIN, UserRole.FRANCHISE_OWNER])]
    }, markInstallationComplete);

    // Generate payment link for installation
    fastify.post('/:id/generate-payment', {
        preHandler: [fastify.authenticate, fastify.authorizeRoles([UserRole.SERVICE_AGENT, UserRole.ADMIN, UserRole.FRANCHISE_OWNER])]
    }, generatePaymentLink);

    // Verify payment and complete installation
    fastify.put('/:id/verify-payment', {
        preHandler: [fastify.authenticate, fastify.authorizeRoles([UserRole.SERVICE_AGENT, UserRole.ADMIN, UserRole.FRANCHISE_OWNER])]
    }, verifyPaymentAndComplete);

    // Refresh payment status
    fastify.post(
        '/:id/refresh-payment',
        {
            preHandler: [fastify.authenticate, fastify.authorize([UserRole.SERVICE_AGENT, UserRole.FRANCHISE_OWNER, UserRole.ADMIN])]
        },
        installationRequestController.refreshPaymentStatus
    );
}