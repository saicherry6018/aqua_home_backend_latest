import { FastifyInstance } from "fastify";
import { checkRoleSchema, loginSchema, meSchema, onboardUserSchema, refreshTokenSchema } from "../schemas/auth.schema";
import { login, refreshToken,onboard,me, checkRole, registerPushToken, getUserDetails } from "../controllers/auth.controller";
import { UserRole } from "../types";



export default async function (fastify: FastifyInstance) {

    fastify.post(
        '/login',
        {
            schema: loginSchema,
        },
        login
    );

    fastify.post(
        '/onboard',
        {
            schema: onboardUserSchema,
            preHandler: [fastify.authenticate],
        },
        (request, reply) => onboard(request as any, reply as any)
    );

    fastify.post(
        '/refresh-token',
        {
            schema: refreshTokenSchema,
        },
        refreshToken
    );

    // Get current user
    fastify.get(
        '/me',
        {
            schema: meSchema,
            preHandler: [fastify.authenticate],
        },
        me
    );

    fastify.get(
        "/checkrole",
        {
         schema: checkRoleSchema
        },
        checkRole
      )

    // Register push token
    fastify.post(
        '/register-push-token',
        {
            // Define schema for registering push token
            preHandler: [fastify.authenticate],
            schema: {
              body: {
                type: 'object',
                required: ['token'],
                properties: {
                  token: { type: 'string' }
                }
              }
            }
        },
        (req,res)=>registerPushToken(req as any,res)
    );

    // Get user details (customers, franchise owners, and admins)
    fastify.get(
        '/users/:userId/details',
        {
            preHandler: [fastify.authenticate, fastify.authorizeRoles([UserRole.CUSTOMER, UserRole.FRANCHISE_OWNER, UserRole.ADMIN])],
            schema: {
                params: {
                    type: 'object',
                    required: ['userId'],
                    properties: {
                        userId: { type: 'string' }
                    }
                }
            }
        },
        (req,res)=>getUserDetails(req as any,res)
    );


}