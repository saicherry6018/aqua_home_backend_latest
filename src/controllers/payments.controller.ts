
import { FastifyRequest, FastifyReply } from 'fastify';
import { handleError } from '../utils/errors';
import * as paymentsService from '../services/payments.service';

/**
 * Get payments based on user role
 */
export async function getPayments(
    request: FastifyRequest,
    reply: FastifyReply
) {
    try {
        const user = request.user;
        const payments = await paymentsService.getPaymentsByRole(user);
        
        return reply.code(200).send({
            payments,
            total: payments.length
        });
    } catch (error) {
        handleError(error, request, reply);
    }
}

/**
 * Get payment by ID
 */
export async function getPaymentById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
) {
    try {
        const { id } = request.params;
        const user = request.user;
        
        const payment = await paymentsService.getPaymentById(id, user);
        
        return reply.code(200).send({ payment });
    } catch (error) {
        handleError(error, request, reply);
    }
}
