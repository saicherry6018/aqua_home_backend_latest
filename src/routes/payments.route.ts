
import { FastifyInstance } from 'fastify';
import { getPayments, getPaymentById } from '../controllers/payments.controller';
import { getPaymentsSchema, getPaymentByIdSchema } from '../schemas/payments.schema';

export default async function (fastify: FastifyInstance) {
    // Get payments based on role
    fastify.get(
        '/',
        {
            schema: getPaymentsSchema,
            preHandler: [fastify.authenticate],
        },
        (request, reply) => getPayments(request as any, reply as any)
    );

    // Get payment by ID
    fastify.get(
        '/:id',
        {
            schema: getPaymentByIdSchema,
            preHandler: [fastify.authenticate],
        },
        (request, reply) => getPaymentById(request as any, reply as any)
    );

    fastify.log.info('Payments routes registered');
}
