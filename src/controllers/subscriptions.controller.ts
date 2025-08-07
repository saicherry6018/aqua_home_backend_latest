import { FastifyRequest, FastifyReply } from 'fastify';
import * as subscriptionService from '../services/subscriptions.service';
import { handleError, notFound, badRequest, forbidden } from '../utils/errors';
import { UserRole } from '../types';

// Create a new subscription
export async function createSubscription(
  request: FastifyRequest<{ 
    Body: { 
      installationRequestId: string;
      planName: string;
      monthlyAmount: number;
      depositAmount: number;
      startDate?: string;
      endDate?: string;
      enableAutoPayment?: boolean;
    } 
  }>,
  reply: FastifyReply
) {
  try {
    const user = request.user;
    const subscriptionData = request.body;

    // Only admin or franchise owner can create subscriptions
    if (![UserRole.ADMIN, UserRole.FRANCHISE_OWNER].includes(user.role)) {
      throw forbidden('You do not have permission to create subscriptions');
    }

    console.log('Creating subscription with data:', subscriptionData);

    const result = await subscriptionService.createSubscription(subscriptionData, user);
    return reply.code(201).send({ 
      message: 'Subscription created successfully', 
      subscription: result.subscription,
      razorpayOrder: result.razorpayOrder
    });
  } catch (error) {
    console.error('Error creating subscription:', error);
    handleError(error, request, reply);
  }
}

// Check subscription by connect ID
export async function checkSubscription(
  request: FastifyRequest<{ 
    Body: { 
      connectId: string;
      customerPhone: string;
    } 
  }>,
  reply: FastifyReply
) {
  try {
    const { connectId, customerPhone } = request.body;

    console.log('Checking subscription for connect ID:', connectId);

    const result = await subscriptionService.checkSubscriptionByConnectId(connectId, customerPhone);
    console.log('result ',result)
    return reply.code(200).send(result);
  } catch (error) {
    console.error('Error checking subscription:', error);
    handleError(error, request, reply);
  }
}

// Get all subscriptions
export async function getAllSubscriptions(
  request: FastifyRequest<{ Querystring: any }>,
  reply: FastifyReply
) {
  try {
    const filters = request.query;
    const user = request.user;

    console.log('Getting all subscriptions with filters:', filters);

    const result = await subscriptionService.getAllSubscriptions(filters, user);
    return reply.code(200).send(result);
  } catch (error) {
    handleError(error, request, reply);
  }
}

// Get subscription by ID
export async function getSubscriptionById(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const user = request.user;
    
    const subscription = await subscriptionService.getSubscriptionById(id);
    if (!subscription) throw notFound('Subscription');

    console.log('subscription:', subscription);
    console.log('user:', user);
    
    // Permission: admin, franchise owner (owns franchise), or customer (owns subscription)
    let hasPermission = false;
    
    if (user.role === UserRole.ADMIN) {
      hasPermission = true;
    } else if (user.role === UserRole.CUSTOMER && subscription.customerId === user.userId) {
      hasPermission = true;
    } else if (user.role === UserRole.FRANCHISE_OWNER) {
      const franchise = await subscriptionService.getFranchiseById(subscription.franchiseId);
      hasPermission = franchise && franchise.ownerId === user.userId;
    }
    
    if (!hasPermission) throw forbidden('You do not have permission to view this subscription');
    
    return reply.code(200).send({ subscription });
  } catch (error) {
    handleError(error, request, reply);
  }
}

// Update subscription
export async function updateSubscription(
  request: FastifyRequest<{ 
    Params: { id: string };
    Body: { 
      status?: string;
      planName?: string;
      monthlyAmount?: number;
      endDate?: string;
      nextPaymentDate?: string;
      reason?: string;
    } 
  }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const updateData = request.body;
    const user = request.user;

    console.log('Updating subscription:', id, 'with data:', updateData);

    const subscription = await subscriptionService.updateSubscription(id, updateData, user);
    return reply.code(200).send({ 
      message: 'Subscription updated successfully', 
      subscription 
    });
  } catch (error) {
    handleError(error, request, reply);
  }
}

// Pause subscription
export async function pauseSubscription(
  request: FastifyRequest<{ 
    Params: { id: string };
    Body: { 
      reason?: string;
      pauseDuration?: number;
    } 
  }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const { reason, pauseDuration } = request.body;
    const user = request.user;

    console.log('Pausing subscription:', id);

    const subscription = await subscriptionService.pauseSubscription(id, user, { reason, pauseDuration });
    return reply.code(200).send({ 
      message: 'Subscription paused successfully', 
      subscription 
    });
  } catch (error) {
    handleError(error, request, reply);
  }
}

// Resume subscription
export async function resumeSubscription(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const user = request.user;

    console.log('Resuming subscription:', id);

    const subscription = await subscriptionService.resumeSubscription(id, user);
    return reply.code(200).send({ 
      message: 'Subscription resumed successfully', 
      subscription 
    });
  } catch (error) {
    handleError(error, request, reply);
  }
}

// Terminate subscription
export async function terminateSubscription(
  request: FastifyRequest<{ 
    Params: { id: string };
    Body: { 
      reason: string;
      refundDeposit?: boolean;
    } 
  }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const { reason, refundDeposit } = request.body;
    const user = request.user;

    console.log('Terminating subscription:', id);

    const subscription = await subscriptionService.terminateSubscription(id, user, { reason, refundDeposit });
    return reply.code(200).send({ 
      message: 'Subscription terminated successfully', 
      subscription 
    });
  } catch (error) {
    handleError(error, request, reply);
  }
}

// Generate payment link for subscription
export async function generateSubscriptionPaymentLink(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const user = request.user;

    console.log('Generating payment link for subscription:', id);

    const result = await subscriptionService.generatePaymentLink(id, user);
    return reply.code(200).send(result);
  } catch (error) {
    handleError(error, request, reply);
  }
}

// Refresh payment status for subscription
export async function refreshSubscriptionPaymentStatus(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const user = request.user;

    console.log('Refreshing payment status for subscription:', id);

    const result = await subscriptionService.refreshPaymentStatus(id, user);
    return reply.code(200).send(result);
  } catch (error) {
    handleError(error, request, reply);
  }
}

// Mark payment as completed manually (for cash/UPI payments)
export async function markSubscriptionPaymentCompleted(
  request: FastifyRequest<{
    Params: { id: string };
    Body: {
      paymentMethod: 'CASH' | 'UPI';
      paymentImage?: string;
      notes?: string;
    }
  }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const { paymentMethod, paymentImage, notes } = request.body;
    const user = request.user;

    console.log('Marking subscription payment as completed:', id);

    const result = await subscriptionService.markPaymentCompleted(id, {
      paymentMethod,
      paymentImage,
      notes
    }, user);

    return reply.code(200).send(result);
  } catch (error) {
    handleError(error, request, reply);
  }
}