import { FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { subscriptions, payments } from '../models/schema';
import { PaymentStatus, ActionType } from '../types';
import { generateId } from '../utils/helpers';
import { getFastifyInstance } from '../shared/fastify-instance';
import { logActionHistory } from '../utils/actionHistory';
import crypto from 'crypto';

// Verify Razorpay webhook signature
function verifyWebhookSignature(body: string, signature: string, secret: string): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return expectedSignature === signature;
}

// Handle Razorpay webhooks
export async function handleRazorpayWebhook(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const fastify = getFastifyInstance();
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'your_webhook_secret';
    const signature = request.headers['x-razorpay-signature'] as string;
    const body = JSON.stringify(request.body);

    // Verify webhook signature
    if (!verifyWebhookSignature(body, signature, webhookSecret)) {
      console.error('Invalid webhook signature');
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    const payload = request.body as any;
    const event = payload.event;
    const paymentEntity = payload.payload?.payment?.entity;
    const subscriptionEntity = payload.payload?.subscription?.entity;

    console.log('Razorpay webhook received:', event);

    switch (event) {
      case 'payment.captured':
        await handlePaymentCaptured(paymentEntity);
        break;
      
      case 'payment.failed':
        await handlePaymentFailed(paymentEntity);
        break;
      
      case 'subscription.charged':
        await handleSubscriptionCharged(subscriptionEntity, paymentEntity);
        break;
      
      case 'subscription.halted':
        await handleSubscriptionHalted(subscriptionEntity);
        break;
      
      case 'subscription.cancelled':
        await handleSubscriptionCancelled(subscriptionEntity);
        break;
      
      case 'subscription.completed':
        await handleSubscriptionCompleted(subscriptionEntity);
        break;
      
      default:
        console.log('Unhandled webhook event:', event);
    }

    return reply.code(200).send({ status: 'ok' });
  } catch (error) {
    console.error('Error handling Razorpay webhook:', error);
    return reply.code(500).send({ error: 'Internal server error' });
  }
}

// Handle successful payment capture
async function handlePaymentCaptured(paymentEntity: any) {
  const fastify = getFastifyInstance();
  
  try {
    // Find payment record by Razorpay payment ID
    const payment = await fastify.db.query.payments.findFirst({
      where: eq(payments.razorpayPaymentId, paymentEntity.id)
    });

    if (payment) {
      // Update payment status
      await fastify.db.update(payments).set({
        status: PaymentStatus.COMPLETED,
        paidDate: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).where(eq(payments.id, payment.id));

      // Log action history
      await logActionHistory({
        paymentId: payment.id,
        subscriptionId: payment.subscriptionId || undefined,
        actionType: ActionType.PAYMENT_COMPLETED,
        fromStatus: PaymentStatus.PENDING,
        toStatus: PaymentStatus.COMPLETED,
        performedBy: 'system',
        performedByRole: 'ADMIN' as any,
        comment: 'Payment captured via Razorpay',
        metadata: { razorpayPaymentId: paymentEntity.id, amount: paymentEntity.amount }
      });

      console.log('Payment captured successfully:', payment.id);
    } else {
      console.error('Payment record not found for Razorpay payment ID:', paymentEntity.id);
    }
  } catch (error) {
    console.error('Error handling payment captured:', error);
  }
}

// Handle failed payment
async function handlePaymentFailed(paymentEntity: any) {
  const fastify = getFastifyInstance();
  
  try {
    // Find payment record by Razorpay payment ID
    const payment = await fastify.db.query.payments.findFirst({
      where: eq(payments.razorpayPaymentId, paymentEntity.id)
    });

    if (payment) {
      // Update payment status
      await fastify.db.update(payments).set({
        status: PaymentStatus.FAILED,
        updatedAt: new Date().toISOString(),
      }).where(eq(payments.id, payment.id));

      // Log action history
      await logActionHistory({
        paymentId: payment.id,
        subscriptionId: payment.subscriptionId || undefined,
        actionType: ActionType.PAYMENT_FAILED,
        fromStatus: PaymentStatus.PENDING,
        toStatus: PaymentStatus.FAILED,
        performedBy: 'system',
        performedByRole: 'ADMIN' as any,
        comment: 'Payment failed via Razorpay',
        metadata: { 
          razorpayPaymentId: paymentEntity.id, 
          errorCode: paymentEntity.error_code,
          errorDescription: paymentEntity.error_description
        }
      });

      console.log('Payment failed:', payment.id);
      
      // TODO: Send notification to customer about failed payment
      // TODO: Consider pausing subscription after multiple failures
    } else {
      console.error('Payment record not found for Razorpay payment ID:', paymentEntity.id);
    }
  } catch (error) {
    console.error('Error handling payment failed:', error);
  }
}

// Handle subscription charged (recurring payment)
async function handleSubscriptionCharged(subscriptionEntity: any, paymentEntity: any) {
  const fastify = getFastifyInstance();
  
  try {
    // Find subscription by Razorpay subscription ID
    const subscription = await fastify.db.query.subscriptions.findFirst({
      where: eq(subscriptions.razorpaySubscriptionId, subscriptionEntity.id)
    });

    if (subscription) {
      // Create payment record for the recurring payment
      const paymentId = await generateId('pay');
      await fastify.db.insert(payments).values({
        id: paymentId,
        subscriptionId: subscription.id,
        amount: paymentEntity.amount / 100, // Convert from paise to rupees
        type: 'SUBSCRIPTION' as any,
        status: PaymentStatus.COMPLETED,
        paymentMethod: 'RAZORPAY_AUTOPAY',
        razorpayPaymentId: paymentEntity.id,
        razorpaySubscriptionId: subscriptionEntity.id,
        paidDate: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Update subscription's next payment date
      const nextPaymentDate = new Date();
      nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
      
      await fastify.db.update(subscriptions).set({
        currentPeriodStartDate: new Date().toISOString(),
        currentPeriodEndDate: nextPaymentDate.toISOString(),
        nextPaymentDate: nextPaymentDate.toISOString(),
        updatedAt: new Date().toISOString(),
      }).where(eq(subscriptions.id, subscription.id));

      // Log action history
      await logActionHistory({
        paymentId,
        subscriptionId: subscription.id,
        actionType: ActionType.PAYMENT_COMPLETED,
        toStatus: PaymentStatus.COMPLETED,
        performedBy: 'system',
        performedByRole: 'ADMIN' as any,
        comment: 'Recurring payment processed via Razorpay AutoPay',
        metadata: { 
          razorpayPaymentId: paymentEntity.id,
          razorpaySubscriptionId: subscriptionEntity.id,
          amount: paymentEntity.amount / 100
        }
      });

      console.log('Subscription charged successfully:', subscription.id);
      
      // TODO: Send notification to customer about successful payment
    } else {
      console.error('Subscription not found for Razorpay subscription ID:', subscriptionEntity.id);
    }
  } catch (error) {
    console.error('Error handling subscription charged:', error);
  }
}

// Handle subscription halted (due to payment failures)
async function handleSubscriptionHalted(subscriptionEntity: any) {
  const fastify = getFastifyInstance();
  
  try {
    // Find subscription by Razorpay subscription ID
    const subscription = await fastify.db.query.subscriptions.findFirst({
      where: eq(subscriptions.razorpaySubscriptionId, subscriptionEntity.id)
    });

    if (subscription) {
      // Pause the subscription
      await fastify.db.update(subscriptions).set({
        status: 'PAUSED' as any,
        updatedAt: new Date().toISOString(),
      }).where(eq(subscriptions.id, subscription.id));

      // Log action history
      await logActionHistory({
        subscriptionId: subscription.id,
        actionType: ActionType.SUBSCRIPTION_PAUSED,
        fromStatus: 'ACTIVE',
        toStatus: 'PAUSED',
        performedBy: 'system',
        performedByRole: 'ADMIN' as any,
        comment: 'Subscription halted due to payment failures',
        metadata: { razorpaySubscriptionId: subscriptionEntity.id }
      });

      console.log('Subscription halted:', subscription.id);
      
      // TODO: Send notification to customer and franchise owner
    }
  } catch (error) {
    console.error('Error handling subscription halted:', error);
  }
}

// Handle subscription cancelled
async function handleSubscriptionCancelled(subscriptionEntity: any) {
  const fastify = getFastifyInstance();
  
  try {
    // Find subscription by Razorpay subscription ID
    const subscription = await fastify.db.query.subscriptions.findFirst({
      where: eq(subscriptions.razorpaySubscriptionId, subscriptionEntity.id)
    });

    if (subscription) {
      // Terminate the subscription
      await fastify.db.update(subscriptions).set({
        status: 'TERMINATED' as any,
        updatedAt: new Date().toISOString(),
      }).where(eq(subscriptions.id, subscription.id));

      // Log action history
      await logActionHistory({
        subscriptionId: subscription.id,
        actionType: ActionType.SUBSCRIPTION_TERMINATED,
        fromStatus: subscription.status,
        toStatus: 'TERMINATED',
        performedBy: 'system',
        performedByRole: 'ADMIN' as any,
        comment: 'Subscription cancelled via Razorpay',
        metadata: { razorpaySubscriptionId: subscriptionEntity.id }
      });

      console.log('Subscription cancelled:', subscription.id);
      
      // TODO: Send notification to customer and franchise owner
      // TODO: Create uninstallation service request
    }
  } catch (error) {
    console.error('Error handling subscription cancelled:', error);
  }
}

// Handle subscription completed
async function handleSubscriptionCompleted(subscriptionEntity: any) {
  const fastify = getFastifyInstance();
  
  try {
    // Find subscription by Razorpay subscription ID
    const subscription = await fastify.db.query.subscriptions.findFirst({
      where: eq(subscriptions.razorpaySubscriptionId, subscriptionEntity.id)
    });

    if (subscription) {
      // Mark subscription as expired
      await fastify.db.update(subscriptions).set({
        status: 'EXPIRED' as any,
        updatedAt: new Date().toISOString(),
      }).where(eq(subscriptions.id, subscription.id));

      // Log action history
      await logActionHistory({
        subscriptionId: subscription.id,
        actionType: ActionType.SUBSCRIPTION_EXPIRED,
        fromStatus: subscription.status,
        toStatus: 'EXPIRED',
        performedBy: 'system',
        performedByRole: 'ADMIN' as any,
        comment: 'Subscription completed/expired via Razorpay',
        metadata: { razorpaySubscriptionId: subscriptionEntity.id }
      });

      console.log('Subscription completed:', subscription.id);
      
      // TODO: Send notification to customer and franchise owner
      // TODO: Create uninstallation service request
    }
  } catch (error) {
    console.error('Error handling subscription completed:', error);
  }
}