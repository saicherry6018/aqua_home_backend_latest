import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import Razorpay from 'razorpay';

declare module 'fastify' {
  interface FastifyInstance {
    razorpay: Razorpay;
  }
}

export default fp(async function (fastify: FastifyInstance) {
  // Check if Razorpay credentials are available
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    fastify.log.warn('Razorpay configuration missing. Razorpay plugin not initialized.');
    return;
  }

  try {
    // Initialize Razorpay
    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    // Decorate Fastify instance with razorpay
    fastify.decorate('razorpay', razorpay);
    
    fastify.log.info('Razorpay plugin registered');
  } catch (err) {
    fastify.log.error('Error initializing Razorpay:', err);
    throw err;
  }
});