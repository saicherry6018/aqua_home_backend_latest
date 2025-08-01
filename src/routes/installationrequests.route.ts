
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
    completeInstallation
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

    // Complete installation (Service Agent only)
    fastify.post(
        '/:id/complete',
        {
            schema: completeInstallationSchema,
            preHandler: [fastify.authenticate, fastify.authorizeRoles(['SERVICE_AGENT'])],
        },
        (req, rep) => completeInstallation(req as any, rep)

    );
}
