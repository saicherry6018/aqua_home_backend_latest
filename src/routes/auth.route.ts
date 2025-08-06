import { FastifyInstance } from "fastify";
import { checkRoleSchema, loginSchema, meSchema, onboardUserSchema, refreshTokenSchema } from "../schemas/auth.schema";
import { login, refreshToken,onboard,me, checkRole, registerPushToken } from "../controllers/auth.controller";



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
        registerPushToken
    );


}