import { FastifyInstance } from 'fastify';
import { eq, and, or, like, desc, count } from 'drizzle-orm';
import { subscriptions, users, products, installationRequests, franchises, payments } from '../models/schema';
import { RentalStatus, UserRole, InstallationRequestStatus, PaymentType, PaymentStatus, ActionType } from '../types';
import { generateId, parseJsonSafe } from '../utils/helpers';
import { notFound, badRequest, forbidden } from '../utils/errors';
import { getFastifyInstance } from '../shared/fastify-instance';
import { logActionHistory } from '../utils/actionHistory';
import Razorpay from 'razorpay';

// Initialize Razorpay (you should put these in environment variables)
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'your_razorpay_key_id',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'your_razorpay_key_secret',
});

// Helper function to get franchise by ID
export async function getFranchiseById(franchiseId: string) {
  const fastify = getFastifyInstance();
  return await fastify.db.query.franchises.findFirst({
    where: eq(franchises.id, franchiseId)
  });
}

// Helper function to generate connect ID
async function generateConnectId(): Promise<string> {
  const fastify = getFastifyInstance();
  let connectId: string;
  let exists = true;

  // Generate unique connect ID
  while (exists) {
    connectId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const existing = await fastify.db.query.subscriptions.findFirst({
      where: eq(subscriptions.connectId, connectId)
    });
    exists = !!existing;
  }

  return connectId!;
}

// Helper function to calculate next payment date
function calculateNextPaymentDate(currentDate: Date, intervalMonths: number = 1): Date {
  const nextDate = new Date(currentDate);
  nextDate.setMonth(nextDate.getMonth() + intervalMonths);
  return nextDate;
}

// Create a new subscription
export async function createSubscription(data: {
  installationRequestId: string;
  planName: string;
  monthlyAmount: number;
  depositAmount: number;
  startDate?: string;
  endDate?: string;
  enableAutoPayment?: boolean;
}, user: any) {
  const fastify = getFastifyInstance();
  const id = await generateId('sub');
  const now = new Date().toISOString();

  console.log('Creating subscription with data:', data);

  // Get installation request and validate
  const installationRequest = await fastify.db.query.installationRequests.findFirst({
    where: eq(installationRequests.id, data.installationRequestId),
    with: {
      product: true,
      customer: true,
      franchise: true,
    }
  });

  if (!installationRequest) throw notFound('Installation Request');
  
  // Check if installation is completed
  if (installationRequest.status !== InstallationRequestStatus.INSTALLATION_COMPLETED) {
    throw badRequest('Installation must be completed before creating subscription');
  }

  // Check if installation request is for rental
  if (installationRequest.orderType !== 'RENTAL') {
    throw badRequest('Subscription can only be created for rental orders');
  }

  // Check permissions
  if (user.role === UserRole.FRANCHISE_OWNER) {
    const franchise = await getFranchiseById(installationRequest.franchiseId);
    if (!franchise || franchise.ownerId !== user.userId) {
      throw forbidden('Installation request is not in your franchise area');
    }
  }

  // Check if subscription already exists for this installation request
  const existingSubscription = await fastify.db.query.subscriptions.findFirst({
    where: eq(subscriptions.requestId, data.installationRequestId)
  });
  if (existingSubscription) {
    throw badRequest('Subscription already exists for this installation request');
  }

  // Generate connect ID
  const connectId = await generateConnectId();

  // Calculate dates
  const startDate = data.startDate ? new Date(data.startDate) : new Date();
  const currentPeriodStartDate = startDate;
  const currentPeriodEndDate = calculateNextPaymentDate(startDate);
  const nextPaymentDate = currentPeriodEndDate;

  let razorpaySubscriptionId: string | null = null;
  let razorpayOrder: any = null;

  // Create Razorpay subscription if auto payment is enabled
  if (data.enableAutoPayment && installationRequest.customer) {
    try {
      // First create a Razorpay plan
      const razorpayPlan = await razorpay.plans.create({
        period: 'monthly',
        interval: 1,
        item: {
          name: data.planName,
          amount: data.monthlyAmount * 100, // Razorpay expects amount in paise
          currency: 'INR',
          description: `Monthly rental for ${installationRequest.product?.name}`,
        }
      });

      // Create Razorpay subscription
      const razorpaySubscription = await razorpay.subscriptions.create({
        plan_id: razorpayPlan.id,
        customer_notify: 1,
        quantity: 1,
        total_count: data.endDate ?  12  : 240, // 20 years if no end date
        start_at: Math.floor(nextPaymentDate.getTime() / 1000), // Start from next payment date
        addons: [],
        notes: {
          connectId,
          customerId: installationRequest.customerId,
          installationRequestId: data.installationRequestId,
        }
      });

      razorpaySubscriptionId = razorpaySubscription.id;

      // Create order for initial deposit if needed
      if (data.depositAmount > 0) {
        razorpayOrder = await razorpay.orders.create({
          amount: data.depositAmount * 100, // Amount in paise
          currency: 'INR',
          notes: {
            type: 'deposit',
            subscriptionId: id,
            connectId,
          }
        });
      }

    } catch (error) {
      console.error('Failed to create Razorpay subscription:', error);
      // Continue without auto payment for now
      console.log('Continuing subscription creation without auto payment');
    }
  }

  const subscription = {
    id,
    connectId,
    requestId: data.installationRequestId,
    customerId: installationRequest.customerId,
    productId: installationRequest.productId,
    franchiseId: installationRequest.franchiseId,
    planName: data.planName,
    status: RentalStatus.ACTIVE,
    startDate: startDate.toISOString(),
    endDate: data.endDate ? new Date(data.endDate).toISOString() : null,
    currentPeriodStartDate: currentPeriodStartDate.toISOString(),
    currentPeriodEndDate: currentPeriodEndDate.toISOString(),
    nextPaymentDate: nextPaymentDate.toISOString(),
    monthlyAmount: data.monthlyAmount,
    depositAmount: data.depositAmount,
    razorpaySubscriptionId,
    createdAt: now,
    updatedAt: now,
  };

  console.log('Inserting subscription:', subscription);

  await fastify.db.insert(subscriptions).values(subscription);

  // Create deposit payment record if applicable
  if (data.depositAmount > 0) {
    const depositPaymentId = await generateId('pay');
    await fastify.db.insert(payments).values({
      id: depositPaymentId,
      subscriptionId: id,
      amount: data.depositAmount,
      type: PaymentType.DEPOSIT,
      status: PaymentStatus.PENDING,
      paymentMethod: razorpayOrder ? 'RAZORPAY_MANUAL' : 'CASH',
      razorpayOrderId: razorpayOrder?.id || null,
      dueDate: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Log action history
  await logActionHistory({
    subscriptionId: id,
    actionType: ActionType.SUBSCRIPTION_ACTIVATED,
    toStatus: RentalStatus.ACTIVE,
    performedBy: user.userId,
    performedByRole: user.role,
    comment: `Subscription created with connect ID: ${connectId}`,
    metadata: {
      planName: data.planName,
      monthlyAmount: data.monthlyAmount,
      depositAmount: data.depositAmount,
      connectId,
      enableAutoPayment: data.enableAutoPayment,
      razorpaySubscriptionId
    }
  });

  // TODO: Send notification to customer with connect ID

  const createdSubscription = await getSubscriptionById(id);
  return {
    subscription: createdSubscription,
    razorpayOrder: razorpayOrder ? {
      id: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      key: process.env.RAZORPAY_KEY_ID || 'your_razorpay_key_id',
    } : undefined
  };
}

// Check subscription by connect ID
export async function checkSubscriptionByConnectId(connectId: string, customerPhone: string) {
  const fastify = getFastifyInstance();
  
  const subscription = await fastify.db.query.subscriptions.findFirst({
    where: eq(subscriptions.connectId, connectId.toUpperCase()),
    with: {
      customer: true,
      product: true,
      franchise: true,
      serviceRequests:true

    },
  });

  if (!subscription) {
    return {
      isValid: false,
      message: 'Invalid connect ID'
    };
  }

  // Verify customer phone matches
  if (subscription.customer?.phone !== customerPhone) {
    return {
      isValid: false,
      message: 'Phone number does not match subscription'
    };
  }

  // Check if subscription is active
  if (subscription.status !== RentalStatus.ACTIVE) {
    return {
      isValid: false,
      message: `Subscription is ${subscription.status}`,
      subscription: {
        ...subscription,
        product: subscription.product ? {
          ...subscription.product,
          images: parseJsonSafe<string[]>(subscription.product.images as any, [])
        } : null
      }
    };
  }

  return {
    isValid: true,
    message: 'Valid subscription',
    subscription: {
      ...subscription,
      product: subscription.product ? {
        ...subscription.product,
        images: parseJsonSafe<string[]>(subscription.product.images as any, [])
      } : null
    }
  };
}

// Get all subscriptions with filtering and pagination
export async function getAllSubscriptions(filters: any, user: any) {
  const fastify = getFastifyInstance();
  let whereConditions: any[] = [];

  // Role-based filtering
  if (user.role === UserRole.FRANCHISE_OWNER) {
    // Get user's owned franchise
    const ownedFranchise = await fastify.db.query.franchises.findFirst({
      where: eq(franchises.ownerId, user.userId)
    });
    if (!ownedFranchise) return { subscriptions: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    whereConditions.push(eq(subscriptions.franchiseId, ownedFranchise.id));
  } else if (user.role === UserRole.CUSTOMER) {
    whereConditions.push(eq(subscriptions.customerId, user.userId));
  }

  // Additional filters
  if (filters.status) {
    whereConditions.push(eq(subscriptions.status, filters.status));
  }
  if (filters.franchiseId) {
    whereConditions.push(eq(subscriptions.franchiseId, filters.franchiseId));
  }
  if (filters.customerId) {
    whereConditions.push(eq(subscriptions.customerId, filters.customerId));
  }
  if (filters.productId) {
    whereConditions.push(eq(subscriptions.productId, filters.productId));
  }

  const page = filters.page || 1;
  const limit = filters.limit || 20;
  const offset = (page - 1) * limit;

  // Get total count
  const totalResult = await fastify.db.select({ count: count() }).from(subscriptions)
    .where(whereConditions.length ? and(...whereConditions) : undefined);
  const total = totalResult[0]?.count || 0;

  // Get subscriptions with relations
  const results = await fastify.db.query.subscriptions.findMany({
    where: whereConditions.length ? and(...whereConditions) : undefined,
    with: {
      customer: true,
      product: true,
      franchise: true,
      installationRequest: true,
    },
    orderBy: [desc(subscriptions.createdAt)],
    limit,
    offset,
  });

  // Process results
  const processedSubscriptions = results.map(sub => ({
    ...sub,
    product: sub.product ? {
      ...sub.product,
      images: parseJsonSafe<string[]>(sub.product.images as any, [])
    } : null
  }));

  return {
    subscriptions: processedSubscriptions,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    }
  };
}

// Get subscription by ID
export async function getSubscriptionById(id: string) {
  const fastify = getFastifyInstance();
  const result = await fastify.db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, id),
    with: {
      customer: true,
      product: true,
      franchise: true,
      installationRequest: true,
    },
  });

  if (!result) return null;

  return {
    ...result,
    product: result.product ? {
      ...result.product,
      images: parseJsonSafe<string[]>(result.product.images as any, [])
    } : null
  };
}

// Update subscription
export async function updateSubscription(id: string, updateData: {
  status?: string;
  planName?: string;
  monthlyAmount?: number;
  endDate?: string;
  nextPaymentDate?: string;
  reason?: string;
}, user: any) {
  const fastify = getFastifyInstance();
  const subscription = await getSubscriptionById(id);
  if (!subscription) throw notFound('Subscription');

  // Check permissions
  if (user.role === UserRole.FRANCHISE_OWNER) {
    const franchise = await getFranchiseById(subscription.franchiseId);
    if (!franchise || franchise.ownerId !== user.userId) {
      throw forbidden('Subscription is not in your franchise area');
    }
  } else if (![UserRole.ADMIN].includes(user.role)) {
    throw forbidden('You do not have permission to update subscriptions');
  }

  const oldStatus = subscription.status;
  const updateFields: any = {
    updatedAt: new Date().toISOString(),
  };

  if (updateData.status) updateFields.status = updateData.status;
  if (updateData.planName) updateFields.planName = updateData.planName;
  if (updateData.monthlyAmount) updateFields.monthlyAmount = updateData.monthlyAmount;
  if (updateData.endDate !== undefined) updateFields.endDate = updateData.endDate ? new Date(updateData.endDate).toISOString() : null;
  if (updateData.nextPaymentDate) updateFields.nextPaymentDate = new Date(updateData.nextPaymentDate).toISOString();

  await fastify.db.update(subscriptions).set(updateFields).where(eq(subscriptions.id, id));

  // Log action history if status changed
  if (updateData.status && updateData.status !== oldStatus) {
    let actionType: ActionType;
    switch (updateData.status) {
      case RentalStatus.PAUSED:
        actionType = ActionType.SUBSCRIPTION_PAUSED;
        break;
      case RentalStatus.TERMINATED:
        actionType = ActionType.SUBSCRIPTION_TERMINATED;
        break;
      case RentalStatus.EXPIRED:
        actionType = ActionType.SUBSCRIPTION_EXPIRED;
        break;
      case RentalStatus.ACTIVE:
        actionType = ActionType.SUBSCRIPTION_ACTIVATED;
        break;
      default:
        actionType = ActionType.SUBSCRIPTION_ACTIVATED;
    }

    await logActionHistory({
      subscriptionId: id,
      actionType,
      fromStatus: oldStatus,
      toStatus: updateData.status,
      performedBy: user.userId,
      performedByRole: user.role,
      comment: updateData.reason || `Subscription status updated from ${oldStatus} to ${updateData.status}`,
      metadata: updateData
    });
  }

  // TODO: Send notification to customer
  // TODO: Update Razorpay subscription if needed

  return await getSubscriptionById(id);
}

// Pause subscription
export async function pauseSubscription(id: string, user: any, options: { reason?: string; pauseDuration?: number }) {
  const fastify = getFastifyInstance();
  const subscription = await getSubscriptionById(id);
  if (!subscription) throw notFound('Subscription');

  // Check permissions
  if (user.role === UserRole.FRANCHISE_OWNER) {
    const franchise = await getFranchiseById(subscription.franchiseId);
    if (!franchise || franchise.ownerId !== user.userId) {
      throw forbidden('Subscription is not in your franchise area');
    }
  } else if (![UserRole.ADMIN].includes(user.role)) {
    throw forbidden('You do not have permission to pause subscriptions');
  }

  if (subscription.status !== RentalStatus.ACTIVE) {
    throw badRequest('Only active subscriptions can be paused');
  }

  const updateFields: any = {
    status: RentalStatus.PAUSED,
    updatedAt: new Date().toISOString(),
  };

  // If pause duration is specified, calculate resume date
  if (options.pauseDuration) {
    const resumeDate = new Date();
    resumeDate.setDate(resumeDate.getDate() + options.pauseDuration);
    // You might want to add a resumeDate field to the schema
  }

  await fastify.db.update(subscriptions).set(updateFields).where(eq(subscriptions.id, id));

  // Log action history
  await logActionHistory({
    subscriptionId: id,
    actionType: ActionType.SUBSCRIPTION_PAUSED,
    fromStatus: RentalStatus.ACTIVE,
    toStatus: RentalStatus.PAUSED,
    performedBy: user.userId,
    performedByRole: user.role,
    comment: options.reason || 'Subscription paused',
    metadata: { pauseDuration: options.pauseDuration }
  });

  // TODO: Pause Razorpay subscription
  // TODO: Send notification to customer

  return await getSubscriptionById(id);
}

// Resume subscription
export async function resumeSubscription(id: string, user: any) {
  const fastify = getFastifyInstance();
  const subscription = await getSubscriptionById(id);
  if (!subscription) throw notFound('Subscription');

  // Check permissions
  if (user.role === UserRole.FRANCHISE_OWNER) {
    const franchise = await getFranchiseById(subscription.franchiseId);
    if (!franchise || franchise.ownerId !== user.userId) {
      throw forbidden('Subscription is not in your franchise area');
    }
  } else if (![UserRole.ADMIN].includes(user.role)) {
    throw forbidden('You do not have permission to resume subscriptions');
  }

  if (subscription.status !== RentalStatus.PAUSED) {
    throw badRequest('Only paused subscriptions can be resumed');
  }

  // Recalculate payment dates
  const now = new Date();
  const nextPaymentDate = calculateNextPaymentDate(now);

  await fastify.db.update(subscriptions).set({
    status: RentalStatus.ACTIVE,
    currentPeriodStartDate: now.toISOString(),
    currentPeriodEndDate: nextPaymentDate.toISOString(),
    nextPaymentDate: nextPaymentDate.toISOString(),
    updatedAt: now.toISOString(),
  }).where(eq(subscriptions.id, id));

  // Log action history
  await logActionHistory({
    subscriptionId: id,
    actionType: ActionType.SUBSCRIPTION_ACTIVATED,
    fromStatus: RentalStatus.PAUSED,
    toStatus: RentalStatus.ACTIVE,
    performedBy: user.userId,
    performedByRole: user.role,
    comment: 'Subscription resumed',
    metadata: { resumedAt: now.toISOString() }
  });

  // TODO: Resume Razorpay subscription
  // TODO: Send notification to customer

  return await getSubscriptionById(id);
}

// Terminate subscription
export async function terminateSubscription(id: string, user: any, options: { reason: string; refundDeposit?: boolean }) {
  const fastify = getFastifyInstance();
  const subscription = await getSubscriptionById(id);
  if (!subscription) throw notFound('Subscription');

  // Check permissions
  if (user.role === UserRole.FRANCHISE_OWNER) {
    const franchise = await getFranchiseById(subscription.franchiseId);
    if (!franchise || franchise.ownerId !== user.userId) {
      throw forbidden('Subscription is not in your franchise area');
    }
  } else if (![UserRole.ADMIN].includes(user.role)) {
    throw forbidden('You do not have permission to terminate subscriptions');
  }

  if (![RentalStatus.ACTIVE, RentalStatus.PAUSED].includes(subscription.status as RentalStatus)) {
    throw badRequest('Only active or paused subscriptions can be terminated');
  }

  await fastify.db.update(subscriptions).set({
    status: RentalStatus.TERMINATED,
    updatedAt: new Date().toISOString(),
  }).where(eq(subscriptions.id, id));

  // Handle deposit refund if requested
  if (options.refundDeposit && subscription.depositAmount > 0) {
    const refundPaymentId = await generateId('pay');
    await fastify.db.insert(payments).values({
      id: refundPaymentId,
      subscriptionId: id,
      amount: subscription.depositAmount,
      type: PaymentType.DEPOSIT,
      status: PaymentStatus.PENDING,
      paymentMethod: 'REFUND',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // Log action history
  await logActionHistory({
    subscriptionId: id,
    actionType: ActionType.SUBSCRIPTION_TERMINATED,
    fromStatus: subscription.status,
    toStatus: RentalStatus.TERMINATED,
    performedBy: user.userId,
    performedByRole: user.role,
    comment: options.reason,
    metadata: { refundDeposit: options.refundDeposit }
  });

  // TODO: Cancel Razorpay subscription
  // TODO: Send notification to customer
  // TODO: Create uninstallation service request

  return await getSubscriptionById(id);
}

// Generate payment link for subscription
export async function generatePaymentLink(subscriptionId: string, user: any) {
  const fastify = getFastifyInstance();
  const subscription = await getSubscriptionById(subscriptionId);
  
  if (!subscription) throw notFound('Subscription');

  // Check permissions - customer can pay for their own subscription
  if (user.role === UserRole.CUSTOMER && subscription.customerId !== user.userId) {
    throw forbidden('You can only pay for your own subscription');
  } else if (user.role === UserRole.FRANCHISE_OWNER) {
    const franchise = await getFranchiseById(subscription.franchiseId);
    if (!franchise || franchise.ownerId !== user.userId) {
      throw forbidden('Subscription is not in your franchise area');
    }
  } else if (![UserRole.ADMIN, UserRole.SERVICE_AGENT].includes(user.role)) {
    throw forbidden('You do not have permission to generate payment links');
  }

  // Check if subscription is active
  if (subscription.status !== RentalStatus.ACTIVE) {
    throw badRequest('Payment links can only be generated for active subscriptions');
  }

  // Check if there's already a pending payment for this subscription
  const existingPendingPayment = await fastify.db.query.payments.findFirst({
    where: and(
      eq(payments.subscriptionId, subscriptionId),
      eq(payments.status, PaymentStatus.PENDING),
      eq(payments.type, PaymentType.SUBSCRIPTION)
    )
  });

  if (existingPendingPayment && existingPendingPayment.razorpayOrderId) {
    // Return existing payment link
    try {
      const razorpay = fastify.razorpay;
      const orderDetails = await razorpay.orders.fetch(existingPendingPayment.razorpayOrderId);
      
      if (orderDetails.status === 'created') {
        return {
          paymentId: existingPendingPayment.id,
          razorpayOrderId: existingPendingPayment.razorpayOrderId,
          amount: existingPendingPayment.amount,
          currency: 'INR',
          key: process.env.RAZORPAY_KEY_ID,
          message: 'Existing payment link found'
        };
      }
    } catch (error) {
      console.error('Error fetching existing Razorpay order:', error);
    }
  }

  try {
    const razorpay = fastify.razorpay;
    
    // Create Razorpay order
    const razorpayOrder = await razorpay.orders.create({
      amount: subscription.monthlyAmount * 100, // Amount in paise
      currency: 'INR',
      notes: {
        subscriptionId: subscriptionId,
        customerId: subscription.customerId,
        type: 'subscription_payment',
        connectId: subscription.connectId
      }
    });

    // Create or update payment record
    let paymentId: string;
    
    if (existingPendingPayment) {
      // Update existing payment record
      await fastify.db.update(payments).set({
        razorpayOrderId: razorpayOrder.id,
        updatedAt: new Date().toISOString()
      }).where(eq(payments.id, existingPendingPayment.id));
      paymentId = existingPendingPayment.id;
    } else {
      // Create new payment record
      paymentId = await generateId('pay');
      await fastify.db.insert(payments).values({
        id: paymentId,
        subscriptionId: subscriptionId,
        amount: subscription.monthlyAmount,
        type: PaymentType.SUBSCRIPTION,
        status: PaymentStatus.PENDING,
        paymentMethod: 'RAZORPAY_MANUAL',
        razorpayOrderId: razorpayOrder.id,
        dueDate: subscription.nextPaymentDate,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    // Log action history
    await logActionHistory({
      paymentId: paymentId,
      subscriptionId: subscriptionId,
      actionType: ActionType.PAYMENT_INITIATED,
      toStatus: PaymentStatus.PENDING,
      performedBy: user.userId,
      performedByRole: user.role,
      comment: 'Payment link generated for subscription',
      metadata: { 
        razorpayOrderId: razorpayOrder.id,
        amount: subscription.monthlyAmount
      }
    });

    return {
      paymentId: paymentId,
      razorpayOrderId: razorpayOrder.id,
      amount: subscription.monthlyAmount,
      currency: 'INR',
      key: process.env.RAZORPAY_KEY_ID,
      message: 'Payment link generated successfully'
    };

  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    throw badRequest('Failed to generate payment link');
  }
}

// Refresh payment status for subscription
export async function refreshPaymentStatus(subscriptionId: string, user: any) {
  const fastify = getFastifyInstance();
  const subscription = await getSubscriptionById(subscriptionId);
  
  if (!subscription) throw notFound('Subscription');

  // Check permissions
  if (user.role === UserRole.CUSTOMER && subscription.customerId !== user.userId) {
    throw forbidden('You can only check payment status for your own subscription');
  } else if (user.role === UserRole.FRANCHISE_OWNER) {
    const franchise = await getFranchiseById(subscription.franchiseId);
    if (!franchise || franchise.ownerId !== user.userId) {
      throw forbidden('Subscription is not in your franchise area');
    }
  } else if (![UserRole.ADMIN, UserRole.SERVICE_AGENT].includes(user.role)) {
    throw forbidden('You do not have permission to check payment status');
  }

  // Find pending payment for this subscription
  const pendingPayment = await fastify.db.query.payments.findFirst({
    where: and(
      eq(payments.subscriptionId, subscriptionId),
      eq(payments.status, PaymentStatus.PENDING),
      eq(payments.type, PaymentType.SUBSCRIPTION)
    )
  });

  if (!pendingPayment || !pendingPayment.razorpayOrderId) {
    return {
      paymentStatus: 'NOT_FOUND',
      message: 'No pending payment found for this subscription'
    };
  }

  try {
    const razorpay = fastify.razorpay;
    const orderDetails = await razorpay.orders.fetch(pendingPayment.razorpayOrderId);
    
    if (orderDetails.status === 'paid') {
      // Update payment status
      await fastify.db.update(payments).set({
        status: PaymentStatus.COMPLETED,
        paidDate: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }).where(eq(payments.id, pendingPayment.id));

      // Update subscription's next payment date
      const nextPaymentDate = calculateNextPaymentDate(new Date(subscription.nextPaymentDate));
      const currentPeriodEndDate = nextPaymentDate;
      
      await fastify.db.update(subscriptions).set({
        currentPeriodStartDate: new Date().toISOString(),
        currentPeriodEndDate: currentPeriodEndDate.toISOString(),
        nextPaymentDate: nextPaymentDate.toISOString(),
        updatedAt: new Date().toISOString()
      }).where(eq(subscriptions.id, subscriptionId));

      // Log action history
      await logActionHistory({
        paymentId: pendingPayment.id,
        subscriptionId: subscriptionId,
        actionType: ActionType.PAYMENT_COMPLETED,
        fromStatus: PaymentStatus.PENDING,
        toStatus: PaymentStatus.COMPLETED,
        performedBy: user.userId,
        performedByRole: user.role,
        comment: 'Payment status refreshed from Razorpay',
        metadata: { razorpayOrderId: pendingPayment.razorpayOrderId }
      });

      return {
        paymentStatus: 'COMPLETED',
        message: 'Payment completed successfully',
        payment: { ...pendingPayment, status: PaymentStatus.COMPLETED },
        nextPaymentDate: nextPaymentDate.toISOString()
      };
    } else {
      return {
        paymentStatus: 'PENDING',
        message: 'Payment is still pending',
        payment: pendingPayment
      };
    }
  } catch (error) {
    console.error('Error checking Razorpay payment status:', error);
    throw badRequest('Failed to refresh payment status from Razorpay');
  }
}

// Mark payment as completed manually (for cash/UPI payments)
export async function markPaymentCompleted(
  subscriptionId: string,
  paymentData: {
    paymentMethod: 'CASH' | 'UPI';
    paymentImage?: string;
    notes?: string;
  },
  user: any
) {
  const fastify = getFastifyInstance();
  const subscription = await getSubscriptionById(subscriptionId);
  
  if (!subscription) throw notFound('Subscription');

  // Only service agents and franchise owners can mark payments as completed
  if (![UserRole.SERVICE_AGENT, UserRole.FRANCHISE_OWNER, UserRole.ADMIN].includes(user.role)) {
    throw forbidden('You do not have permission to mark payments as completed');
  }

  if (user.role === UserRole.FRANCHISE_OWNER) {
    const franchise = await getFranchiseById(subscription.franchiseId);
    if (!franchise || franchise.ownerId !== user.userId) {
      throw forbidden('Subscription is not in your franchise area');
    }
  }

  // Find pending payment for this subscription
  const pendingPayment = await fastify.db.query.payments.findFirst({
    where: and(
      eq(payments.subscriptionId, subscriptionId),
      eq(payments.status, PaymentStatus.PENDING),
      eq(payments.type, PaymentType.SUBSCRIPTION)
    )
  });

  let paymentId: string;

  if (pendingPayment) {
    // Update existing payment
    await fastify.db.update(payments).set({
      status: PaymentStatus.COMPLETED,
      paymentMethod: paymentData.paymentMethod,
      collectedByAgentId: user.userId,
      receiptImage: paymentData.paymentImage || null,
      paidDate: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }).where(eq(payments.id, pendingPayment.id));
    paymentId = pendingPayment.id;
  } else {
    // Create new payment record
    paymentId = await generateId('pay');
    await fastify.db.insert(payments).values({
      id: paymentId,
      subscriptionId: subscriptionId,
      amount: subscription.monthlyAmount,
      type: PaymentType.SUBSCRIPTION,
      status: PaymentStatus.COMPLETED,
      paymentMethod: paymentData.paymentMethod,
      collectedByAgentId: user.userId,
      receiptImage: paymentData.paymentImage || null,
      dueDate: subscription.nextPaymentDate,
      paidDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  // Update subscription's next payment date
  const nextPaymentDate = calculateNextPaymentDate(new Date(subscription.nextPaymentDate));
  const currentPeriodEndDate = nextPaymentDate;
  
  await fastify.db.update(subscriptions).set({
    currentPeriodStartDate: new Date().toISOString(),
    currentPeriodEndDate: currentPeriodEndDate.toISOString(),
    nextPaymentDate: nextPaymentDate.toISOString(),
    updatedAt: new Date().toISOString()
  }).where(eq(subscriptions.id, subscriptionId));

  // Log action history
  await logActionHistory({
    paymentId: paymentId,
    subscriptionId: subscriptionId,
    actionType: ActionType.PAYMENT_COMPLETED,
    fromStatus: PaymentStatus.PENDING,
    toStatus: PaymentStatus.COMPLETED,
    performedBy: user.userId,
    performedByRole: user.role,
    comment: `Payment marked as completed via ${paymentData.paymentMethod}${paymentData.notes ? ': ' + paymentData.notes : ''}`,
    metadata: { 
      paymentMethod: paymentData.paymentMethod,
      collectedBy: user.userId,
      hasReceiptImage: !!paymentData.paymentImage
    }
  });

  return {
    message: 'Payment marked as completed successfully',
    payment: await fastify.db.query.payments.findFirst({
      where: eq(payments.id, paymentId)
    }),
    nextPaymentDate: nextPaymentDate.toISOString()
  };
}