// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import fp from 'fastify-plugin';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { UserRole } from '../types';

// Extend the FastifyRequest interface to include the user property
declare module 'fastify' {
  interface FastifyRequest {
    user: {
      userId: string;
      role: UserRole;
      franchiseAreaId?: string;
    };
  }
}

// Extend FastifyInstance to include authenticate method
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: any
    ) => Promise<void>;

    authorizeRoles: (
      roles: UserRole[]
    ) => (request: FastifyRequest, reply: any) => Promise<void>;
  }
}

export default fp(async function (fastify: FastifyInstance) {
  // Register JWT verification function
  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: any) {
try {

      console.log('here token is ',request.headers.authorization)
      const decoded = await request.jwtVerify() as { userId: string; role: UserRole; franchiseAreaId?: string; };
      console.log('here in jwt decoded ', decoded);
      request.user = decoded;
      console.log("request.user ", request.user);
    } catch (err) {
      reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid or expired token'
      });
    }
  });

  // Role-based access control middleware
  fastify.decorate('authorizeRoles', function (roles: UserRole[]) {
    return async function (request: FastifyRequest, reply: any) {
      try {
        await request.jwtVerify();

        console.log('roles')

        // Check if the user role is allowed
        if (!roles.includes(request.user.role)) {
          reply.status(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'You do not have permission to access this resource',
          });
        }
      } catch (err) {
        reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid or expired token'
        });
      }
    };
  });

  fastify.log.info('Auth plugin registered');
});