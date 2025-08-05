import { FastifyInstance } from 'fastify';
import { eq, and, or, inArray } from 'drizzle-orm';
import { serviceRequests, users, products, subscriptions, installationRequests, franchises, payments, franchiseAgents } from '../models/schema';
import { ServiceRequestStatus, ServiceRequestType, UserRole, ActionType, InstallationRequestStatus, PaymentStatus } from '../types';
import { generateId, parseJsonSafe } from '../utils/helpers';
import { notFound, badRequest, forbidden } from '../utils/errors';
import { getFastifyInstance } from '../shared/fastify-instance';
import { logActionHistory, createServiceRequestStatusAction } from '../utils/actionHistory';


// Helper function to get user by ID
export async function getUserById(userId: string) {
  const fastify = getFastifyInstance();
  return await fastify.db.query.users.findFirst({
    where: eq(users.id, userId)
  });
}

// Helper function to get franchise by ID
export async function getFranchiseById(franchiseId: string) {
  const fastify = getFastifyInstance();
  return await fastify.db.query.franchises.findFirst({
    where: eq(franchises.id, franchiseId)
  });
}

// Get all service requests (with optional filters)
export async function getAllServiceRequests(filters: any, user: any) {
  const fastify = getFastifyInstance();
  let whereConditions: any[] = [];

  // Role-based filtering
  if (user.role === UserRole.FRANCHISE_OWNER) {
    // Get user's owned franchise
    const userFromDb = await getUserById(user.userId);
    const ownedFranchise = await fastify.db.query.franchises.findFirst({
      where: eq(franchises.ownerId, user.userId)
    });
    if (!ownedFranchise) return [];
    whereConditions.push(eq(serviceRequests.franchiseId, ownedFranchise.id));
  } else if (user.role === UserRole.SERVICE_AGENT) {
    whereConditions.push(eq(serviceRequests.assignedToId, user.userId));
  } else if (user.role === UserRole.CUSTOMER) {
    whereConditions.push(eq(serviceRequests.customerId, user.userId));
  }

  // Additional filters
  if (filters.status) {
    whereConditions.push(eq(serviceRequests.status, filters.status));
  }
  if (filters.type) {
    whereConditions.push(eq(serviceRequests.type, filters.type));
  }
  if (filters.franchiseId) {
    whereConditions.push(eq(serviceRequests.franchiseId, filters.franchiseId));
  }
  if (filters.customerId) {
    whereConditions.push(eq(serviceRequests.customerId, filters.customerId));
  }

  const results = await fastify.db.query.serviceRequests.findMany({
    where: whereConditions.length ? and(...whereConditions) : undefined,
    with: {
      customer: true,
      product: true,
      assignedAgent: true,
      subscription: true,
      installationRequest: true,
    },
    orderBy: (serviceRequests, { desc }) => [desc(serviceRequests.createdAt)],
  });

  // Process results to ensure proper data structure and parse images
  return results.map(sr => ({
    ...sr,
    images: parseJsonSafe<string[]>(sr.images, []),
    beforeImages: parseJsonSafe<string[]>(sr.beforeImages, []),
    afterImages: parseJsonSafe<string[]>(sr.afterImages, []),
    product: sr.product ? {
      ...sr.product,
      images: parseJsonSafe<string[]>(sr.product.images as any, [])
    } : null
  }));
}

// Get service request by ID
export async function getServiceRequestById(id: string) {
  const fastify = getFastifyInstance();
  const result = await fastify.db.query.serviceRequests.findFirst({
    where: eq(serviceRequests.id, id),
    with: {
      customer: true,
      product: true,
      assignedAgent: true,
      subscription: true,
      installationRequest: true,
    },
  });

  if (!result) return null;

  // Add payment status for all service requests that require payment
  let paymentStatus = null;

  // if (result.requiresPayment) {
  //   // First check if there's a payment record for this service request
  //   const servicePayment = await fastify.db.query.payments.findFirst({
  //     where: eq(payments.serviceRequestId, result.id)
  //   });

  //   if (servicePayment) {
  //     paymentStatus = {
  //       status: servicePayment.status,
  //       amount: servicePayment.amount,
  //       method: servicePayment.paymentMethod,
  //       paidDate: servicePayment.paidDate,
  //       razorpayOrderId: servicePayment.razorpayOrderId,
  //       razorpaySubscriptionId: servicePayment.razorpaySubscriptionId
  //     };
  //   } else if (result.status === 'PAYMENT_PENDING') {
  //     // If no payment record but status is PAYMENT_PENDING, show pending status
  //     paymentStatus = {
  //       status: 'PENDING',
  //       amount: result.paymentAmount,
  //       method: null,
  //       paidDate: null,
  //       razorpayOrderId: result.razorpayOrderId,
  //       razorpaySubscriptionId: result.razorpaySubscriptionId
  //     };
  //   }
  // }

  // For installation type service requests, also check installation request payment
  if (result.type === 'installation' && result.installationRequestId) {
    const installationRequest = await fastify.db.query.installationRequests.findFirst({
      where: eq(installationRequests.id, result.installationRequestId),
      with: {
        product: true
      }
    });

    if (installationRequest?.status === 'PAYMENT_PENDING') {
      const installationPayment = await fastify.db.query.payments.findFirst({
        where: eq(payments.installationRequestId, result.installationRequestId)
      });

      paymentStatus = {
        status: installationPayment?.status || 'PENDING',
        amount: installationRequest.orderType === 'RENTAL' ? installationRequest.product.deposit : installationRequest.product.buyPrice,
        method: installationPayment?.paymentMethod || 'Auto_Pay',
        paidDate: installationPayment?.paidDate,
        razorpayPaymentLink: installationRequest.razorpayPaymentLink,
        razorpaySubscriptionId: installationRequest.razorpaySubscriptionId
      };
    }
  }

  // Process result to ensure proper data structure and parse images
  return {
    ...result,
    images: parseJsonSafe<string[]>(result.images, []),
    beforeImages: parseJsonSafe<string[]>(result.beforeImages, []),
    afterImages: parseJsonSafe<string[]>(result.afterImages, []),
    product: result.product ? {
      ...result.product,
      images: parseJsonSafe<string[]>(result.product.images as any, [])
    } : null,
    paymentStatus
  };
}

// Create a new service request - Updated to handle subscriptions and installation requests
export async function createServiceRequest(data: any, user: any) {
  const fastify = getFastifyInstance();
  const id = await generateId('srq');
  const now = new Date().toISOString();

  console.log('Creating service request with data:', data);

  // Get product
  const product = await fastify.db.query.products.findFirst({
    where: eq(products.id, data.productId)
  });
  if (!product) throw notFound('Product');

  let franchiseId: string | null = null;

  // Determine franchise based on subscription or installation request
  if (data.subscriptionId) {
    const subscription = await fastify.db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, data.subscriptionId)
    });
    if (!subscription) throw notFound('Subscription');
    if (subscription.customerId !== user.userId) throw forbidden('Subscription does not belong to you');
    franchiseId = subscription.franchiseId;
  } else if (data.installationRequestId) {
    const installationRequest = await fastify.db.query.installationRequests.findFirst({
      where: eq(installationRequests.id, data.installationRequestId)
    });
    if (!installationRequest) throw notFound('Installation Request');
    if (installationRequest.customerId !== user.userId) throw forbidden('Installation request does not belong to you');
    franchiseId = installationRequest.franchiseId;
  } else {
    // For general service requests, try to get user's franchise
    const userFromDb = await fastify.db.query.users.findFirst({
      where: eq(users.id, user.userId)
    });
    if (!userFromDb?.city) throw badRequest('User city not found. Cannot determine franchise.');

    // Find franchise by city (you might need to implement geo-location based matching)
    const franchise = await fastify.db.query.franchises.findFirst({
      where: eq(franchises.city, userFromDb.city)
    });
    if (!franchise) throw badRequest('No franchise found for your location');
    franchiseId = franchise.id;
  }

  const serviceRequest = {
    id,
    subscriptionId: data.subscriptionId || null,
    customerId: user.userId,
    productId: data.productId,
    installationRequestId: data.installationRequestId || null,
    type: data.type,
    description: data.description,
    images: data.images && data.images.length > 0 ? JSON.stringify(data.images) : null,
    status: ServiceRequestStatus.CREATED,
    assignedToId: null,
    franchiseId,
    scheduledDate: data.scheduledDate || null,
    completedDate: null,
    beforeImages: null,
    afterImages: null,
    requiresPayment: data.requiresPayment || false,
    createdAt: now,
    updatedAt: now,
  };

  console.log('Inserting service request:', serviceRequest);

  await fastify.db.insert(serviceRequests).values(serviceRequest);

  // Log action history
  await logActionHistory(createServiceRequestStatusAction(
    id,
    undefined,
    ServiceRequestStatus.CREATED,
    user.userId,
    user.role,
    { type: data.type, requiresPayment: data.requiresPayment }
  ));

  // Send push notifications for non-installation service requests
  const createdServiceRequest = await getServiceRequestById(id);
  if (createdServiceRequest && !createdServiceRequest.installationRequestId) {
    await sendServiceRequestNotifications(createdServiceRequest, 'created', user);
  }

  return createdServiceRequest;
}

// Create installation service request (for franchise_owner/admin)
export async function createInstallationServiceRequest(data: {
  installationRequestId: string;
  assignedToId?: string;
  scheduledDate?: string;
  description: string;
}, user: any) {
  const fastify = getFastifyInstance();
  const id = await generateId('srq');
  const now = new Date().toISOString();

  // Get installation request
  const installationRequest = await fastify.db.query.installationRequests.findFirst({
    where: eq(installationRequests.id, data.installationRequestId),
    with: {
      product: true,
      customer: true,
    }
  });
  if (!installationRequest) throw notFound('Installation Request');

  // Check if installation service request already exists
  const existingServiceRequest = await fastify.db.query.serviceRequests.findFirst({
    where: and(
      eq(serviceRequests.installationRequestId, data.installationRequestId),
      eq(serviceRequests.type, ServiceRequestType.INSTALLATION)
    )
  });
  if (existingServiceRequest) {
    await fastify.db.update(serviceRequests).set({
      status: ServiceRequestStatus.SCHEDULED,
      assignedToId: data.assignedToId
    }).where(
      eq(serviceRequests.id, existingServiceRequest.id)
    )
    await fastify.db.update(installationRequests).set({
      status: InstallationRequestStatus.INSTALLATION_SCHEDULED
    }).where(
      eq(installationRequests.id, installationRequest.id)
    )
  } else {
    // Check permissions
    if (user.role === UserRole.FRANCHISE_OWNER) {
      const franchise = await getFranchiseById(installationRequest.franchiseId);
      if (!franchise || franchise.ownerId !== user.userId) {
        throw forbidden('Installation request is not in your franchise area');
      }
    }

    // Validate assigned agent if provided
    if (data.assignedToId) {
      const agent = await fastify.db.query.users.findFirst({
        where: eq(users.id, data.assignedToId)
      });
      if (!agent || agent.role !== UserRole.SERVICE_AGENT) {
        throw badRequest('Invalid service agent');
      }
      // For franchise owners, ensure agent is in same franchise (you might need to add franchise checking)
    }

    const serviceRequest = {
      id,
      subscriptionId: null,
      customerId: installationRequest.customerId,
      productId: installationRequest.productId,
      installationRequestId: data.installationRequestId,
      type: ServiceRequestType.INSTALLATION,
      description: data.description,
      images: null,
      status: data.assignedToId ? ServiceRequestStatus.SCHEDULED : ServiceRequestStatus.CREATED,
      assignedToId: data.assignedToId || null,
      franchiseId: installationRequest.franchiseId,
      scheduledDate: data.scheduledDate || null,
      completedDate: null,
      beforeImages: null,
      afterImages: null,
      requiresPayment: true,
      createdAt: now,
      updatedAt: now,
      requirePayment: true
    };

    await fastify.db.insert(serviceRequests).values(serviceRequest);

    await fastify.db.update(installationRequests).set({
      status: InstallationRequestStatus.INSTALLATION_SCHEDULED,
      assignedTechnicianId: data.assignedToId
    }).where(eq(installationRequests.id, installationRequest.id))
  }



  // Log action history for installation request status update
  await logActionHistory({
    installationRequestId: data.installationRequestId,
    actionType: ActionType.INSTALLATION_REQUEST_SCHEDULED,
    fromStatus: installationRequest.status,
    toStatus: InstallationRequestStatus.INSTALLATION_SCHEDULED,
    performedBy: user.userId,
    performedByRole: user.role,
    comment: `Installation scheduled via service request creation`,
    metadata: { serviceRequestId: id, assignedTechnicianId: data.assignedToId }
  })

  // Log action history
  // await logActionHistory(createServiceRequestStatusAction(
  //   id,
  //   undefined,
  //   data.assignedToId ? ServiceRequestStatus.SCHEDULED : ServiceRequestStatus.CREATED,
  //   user.userId,
  //   user.role,
  //   { installationRequestId: data.installationRequestId, assignedToId: data.assignedToId }
  // ));

  // if (data.assignedToId) {
  //   await logActionHistory({
  //     serviceRequestId: id,
  //     actionType: ActionType.SERVICE_REQUEST_ASSIGNED,
  //     fromStatus: ServiceRequestStatus.CREATED,
  //     toStatus: ServiceRequestStatus.ASSIGNED,
  //     performedBy: user.userId,
  //     performedByRole: user.role,
  //     comment: `Service agent assigned during creation`,
  //     metadata: { assignedToId: data.assignedToId }
  //   });
  // }

  // TODO: Send notification to customer and assigned agent (if any)

  return await getServiceRequestById(id);
}

// Update service request status
export async function updateServiceRequestStatus(
  id: string,
  status: ServiceRequestStatus,
  user: any,
  data?: {
    agentId?: string;
    completedAt?: string;
    scheduledDate?: string;
    beforeImages?: string[];
    afterImages?:string[];
  }
) {
  const fastify = getFastifyInstance();
  const db = fastify.db;

  console.log('status came ', status)
  console.log('data came ', data)
  console.log('user ', user)

  const serviceRequest = await getServiceRequestById(id);
  if (!serviceRequest) throw notFound('Service Request');

  console.log('serviceRequest ', serviceRequest)

  // Validate status transitions and required data
  const currentStatus = serviceRequest.status as ServiceRequestStatus;

  // Define valid status transitions
  const validTransitions: Record<ServiceRequestStatus, ServiceRequestStatus[]> = {
    [ServiceRequestStatus.CREATED]: [ServiceRequestStatus.ASSIGNED, ServiceRequestStatus.CANCELLED],
    [ServiceRequestStatus.ASSIGNED]: [ServiceRequestStatus.SCHEDULED, ServiceRequestStatus.CANCELLED],
    [ServiceRequestStatus.SCHEDULED]: [ServiceRequestStatus.IN_PROGRESS, ServiceRequestStatus.CANCELLED],
    [ServiceRequestStatus.IN_PROGRESS]: [ServiceRequestStatus.PAYMENT_PENDING, ServiceRequestStatus.COMPLETED, ServiceRequestStatus.CANCELLED],
    [ServiceRequestStatus.PAYMENT_PENDING]: [ServiceRequestStatus.COMPLETED, ServiceRequestStatus.CANCELLED],
    [ServiceRequestStatus.COMPLETED]: [], // Cannot transition from completed
    [ServiceRequestStatus.CANCELLED]: [ServiceRequestStatus.ASSIGNED, ServiceRequestStatus.SCHEDULED] // Can be reactivated
  };

  // Check if the status transition is valid
  if (!validTransitions[currentStatus]?.includes(status)) {
    throw badRequest(`Invalid status transition from ${currentStatus} to ${status}. Valid transitions are: ${validTransitions[currentStatus]?.join(', ') || 'none'}`);
  }

  const updateData: any = {
    status,
    updatedAt: new Date().toISOString(),
  };


  // Status-specific validations
  switch (status) {
    case ServiceRequestStatus.ASSIGNED:
      if (!data?.agentId) {
        throw badRequest('Agent ID is required for assignment');
      }
      break;

    case ServiceRequestStatus.SCHEDULED:
      if (!serviceRequest.assignedToId) {
        throw badRequest('Cannot schedule without assigned agent');
      }
      if (!data?.scheduledDate) {
        throw badRequest('Scheduled date is required');
      }
      break;

    case ServiceRequestStatus.IN_PROGRESS:
      // For installation type, require before images
      if (serviceRequest.type === 'installation' && (!data?.beforeImages || data.beforeImages.length === 0)) {
        throw badRequest('Before images are required to start installation service requests');
      }
      break;


    case ServiceRequestStatus.PAYMENT_PENDING:
      if (!serviceRequest.requirePayment) {
        throw badRequest('This service request does not require payment');
      }

      // Require completion images
      if (!data?.afterImages || data.afterImages.length === 0) {
        throw badRequest('Completion images are required before requesting payment');
      }
      break;

    case ServiceRequestStatus.COMPLETED:
      // Require completion images
      if (!serviceRequest.installationRequestId && (!data?.afterImages || data.afterImages.length === 0)) {
        throw badRequest('Completion images are required to mark as completed');
      }
      // If it requires payment and coming from IN_PROGRESS, must go through PAYMENT_PENDING first
      if (serviceRequest.requiresPayment && currentStatus === ServiceRequestStatus.IN_PROGRESS) {
        throw badRequest('Service requests requiring payment must go through PAYMENT_PENDING status first');
      }

      const paymnet = await db.query.payments.findFirst({
        where: eq(payments.installationRequestId, serviceRequest.installationRequestId)
      })
      if (!paymnet || paymnet.status !== PaymentStatus.COMPLETED || paymnet.installationRequestId !== serviceRequest.installationRequestId) {
        throw badRequest('Please Complete Payment First');
      }
      break;
    case ServiceRequestStatus.CANCELLED:
      updateData.beforeImages = null
      updateData.afterImages = null
      break
  }


  // Add specific data based on status
  if (data?.agentId) updateData.assignedAgentId = data.agentId;
  if (data?.scheduledDate) updateData.scheduledDate = data.scheduledDate;
  if (status === ServiceRequestStatus.COMPLETED) updateData.completedAt = new Date().toISOString();

  // Handle images - store them properly as JSON strings
  if (data?.afterImages && data.afterImages.length > 0) {
    const imageField = status === ServiceRequestStatus.IN_PROGRESS ? 'beforeImages' : 'afterImages';
    // Ensure images are stored as proper JSON string
    updateData[imageField] = JSON.stringify(data.afterImages);
  }
  if (data?.beforeImages && data.beforeImages.length > 0) {
    const imageField = status === ServiceRequestStatus.IN_PROGRESS ? 'beforeImages' : 'afterImages';
    // Ensure images are stored as proper JSON string
    updateData[imageField] = JSON.stringify(data.beforeImages);
  }
  console.log('updateData ', updateData)
  await db.update(serviceRequests).set(updateData).where(eq(serviceRequests.id, id));
  await syncInstallationRequestStatus(serviceRequest.installationRequestId, status, user)

  // Log action in history
  await logActionHistory({
    entityType: 'service_request',
    entityId: id,
    actionType: `status_updated_to_${status.toLowerCase()}`,
    performedBy: user.userId,
    performedByRole: user.role,
    details: {
      fromStatus: currentStatus,
      toStatus: status,
      agentId: data?.agentId,
      scheduledDate: data?.scheduledDate,
      imagesCount: data?.images?.length || 0
    }
  });

  // If there's a subscription, log it there too
  if (serviceRequest.subscriptionId) {
    await logActionHistory({
      entityType: 'subscription',
      entityId: serviceRequest.subscriptionId,
      actionType: `service_request_${status.toLowerCase()}`,
      performedByRole: user.role,
      performedBy: user.userId,
      details: {
        serviceRequestId: id,
        status: status
      }
    });
  }

  return await getServiceRequestById(id);
}

// Validate service request status transitions and image requirements
async function validateServiceRequestTransition(
  sr: any,
  newStatus: ServiceRequestStatus,
  images?: { beforeImages?: string[]; afterImages?: string[] }
) {
  const currentStatus = sr.status;

  // Validation for SCHEDULED -> IN_PROGRESS transition (requires before images for non-installation types)
  if (currentStatus === ServiceRequestStatus.SCHEDULED && newStatus === ServiceRequestStatus.IN_PROGRESS) {
    console.log('came here ', sr)
    if (sr.type !== ServiceRequestType.INSTALLATION) {
      console.log('camer here beforeImages ', images.beforeImages)
      if (!images?.beforeImages || images.beforeImages.length === 0) {
        throw badRequest('Before images are required when starting service work');
      }
    }
  }

  // Validation for IN_PROGRESS -> PAYMENT_PENDING transition
  if (currentStatus === ServiceRequestStatus.IN_PROGRESS && newStatus === ServiceRequestStatus.PAYMENT_PENDING) {
    if (!sr.requirePayment) {
      throw badRequest('This service request does not require payment');
    }

    // Require after images for payment pending
    if (!images?.afterImages || images.afterImages.length === 0) {
      throw badRequest('After images are required before moving to payment pending');
    }
  }

  // Validation for IN_PROGRESS -> COMPLETED transition (for non-payment services)
  if (currentStatus === ServiceRequestStatus.IN_PROGRESS && newStatus === ServiceRequestStatus.COMPLETED) {
    if (sr.requirePayment) {
      throw badRequest('Service requests requiring payment must go through PAYMENT_PENDING status first');
    }

    // Require after images for completion
    if (!images?.afterImages || images.afterImages.length === 0) {
      throw badRequest('After images are required when completing service work');
    }
  }

  // Validation for PAYMENT_PENDING -> COMPLETED transition
  if (currentStatus === ServiceRequestStatus.PAYMENT_PENDING && newStatus === ServiceRequestStatus.COMPLETED) {
    // This transition is allowed once payment is verified
    // Payment verification should be handled separately
  }

  // Special validation for installation service requests
  if (sr.type === ServiceRequestType.INSTALLATION) {
    await validateInstallationSpecificTransitions(sr, currentStatus, newStatus, images);
  }
}

// Additional validation specific to installation service requests
async function validateInstallationSpecificTransitions(
  sr: any,
  currentStatus: ServiceRequestStatus,
  newStatus: ServiceRequestStatus,
  images?: { beforeImages?: string[]; afterImages?: string[] }
) {
  const fastify = getFastifyInstance();
  // Installation requests always require payment, so enforce payment flow
  if (currentStatus === ServiceRequestStatus.IN_PROGRESS && newStatus === ServiceRequestStatus.COMPLETED) {
    throw badRequest('Installation service requests must go through PAYMENT_PENDING status before completion');
  }

  // Installation completion requires after images
  if (currentStatus === ServiceRequestStatus.IN_PROGRESS && newStatus === ServiceRequestStatus.PAYMENT_PENDING) {
    if (!images?.afterImages || images.afterImages.length === 0) {
      throw badRequest('Installation completion images are required before moving to payment pending');
    }
  }

  // Installation can only be completed after payment verification
  if (currentStatus === ServiceRequestStatus.PAYMENT_PENDING && newStatus === ServiceRequestStatus.COMPLETED) {
    // Additional payment verification logic can be added here if needed
    const installationPayment = await fastify.db.query.payments.findFirst({
      where: and(eq(payments.installationRequestId, sr.installationRequestId), eq(payments.status, PaymentStatus.COMPLETED))

    });

    if (!installationPayment) {
      throw badRequest('please complete payment first')

    }

  }
}

// Sync installation request status based on service request status

// Helper function to map status to action type


// Assign service agent

// Schedule service request



async function syncInstallationRequestStatus(
  installationRequestId: string,
  serviceRequestStatus: ServiceRequestStatus,
  user: any
) {
  const fastify = getFastifyInstance();

  let installationStatus: InstallationRequestStatus | null = null;
  let installationActionType: ActionType | null = null;

  switch (serviceRequestStatus) {
    case ServiceRequestStatus.IN_PROGRESS:
      installationStatus = InstallationRequestStatus.INSTALLATION_IN_PROGRESS;
      installationActionType = ActionType.INSTALLATION_REQUEST_IN_PROGRESS;
      break;
    case ServiceRequestStatus.PAYMENT_PENDING:
      installationStatus = InstallationRequestStatus.PAYMENT_PENDING;
      installationActionType = ActionType.INSTALLATION_REQUEST_COMPLETED;
      break;
    case ServiceRequestStatus.COMPLETED:
      installationStatus = InstallationRequestStatus.INSTALLATION_COMPLETED;
      installationActionType = ActionType.INSTALLATION_REQUEST_COMPLETED;
      break;
    case ServiceRequestStatus.CANCELLED:
      installationStatus = InstallationRequestStatus.CANCELLED;
      installationActionType = ActionType.INSTALLATION_REQUEST_CANCELLED;
      break;
    case ServiceRequestStatus.SCHEDULED:
      installationStatus = InstallationRequestStatus.INSTALLATION_SCHEDULED;
      installationActionType = ActionType.INSTALLATION_REQUEST_SCHEDULED;
      break;
  }
  await fastify.db.update(installationRequests).set({
    status: installationStatus
  }).where(eq(installationRequests.id, installationRequestId))

  await logActionHistory({
    installationRequestId: installationRequestId,
    actionType: installationActionType,
    fromStatus: serviceRequestStatus,
    toStatus: ServiceRequestStatus.ASSIGNED,
    performedBy: user.userId,
    performedByRole: user.role,
    comment: `Service agent ${user.name || user.phone} assigned`
  })
}

export async function assignServiceAgent(id: string, assignedToId: string, user: any) {
  const fastify = getFastifyInstance();
  const sr = await getServiceRequestById(id);
  if (!sr) throw notFound('Service Request');

  // Only admin or franchise owner can assign
  if (![UserRole.ADMIN, UserRole.FRANCHISE_OWNER].includes(user.role)) {
    throw forbidden('You do not have permission to assign service agents');
  }

  // For franchise owners, check if service request is in their franchise
  if (user.role === UserRole.FRANCHISE_OWNER) {
    const franchise = await getFranchiseById(sr.franchiseId);
    if (!franchise || franchise.ownerId !== user.userId) {
      throw forbidden('Service request is not in your franchise area');
    }
  }

  // Check if agent exists and is a service agent
  const agent = await fastify.db.query.users.findFirst({ where: eq(users.id, assignedToId) });
  if (!agent || agent.role !== UserRole.SERVICE_AGENT) {
    throw badRequest('Invalid service agent');
  }

  const oldStatus = sr.status;
  await fastify.db.update(serviceRequests).set({
    assignedToId,
    status: ServiceRequestStatus.ASSIGNED,
    updatedAt: new Date().toISOString(),
  }).where(eq(serviceRequests.id, id));

  // Log action history
  await logActionHistory({
    serviceRequestId: id,
    actionType: ActionType.SERVICE_REQUEST_ASSIGNED,
    fromStatus: oldStatus,
    toStatus: ServiceRequestStatus.ASSIGNED,
    performedBy: user.userId,
    performedByRole: user.role,
    comment: `Service agent ${agent.name || agent.phone} assigned`,
    metadata: { assignedToId, agentName: agent.name, agentPhone: agent.phone }
  });

  // TODO: Send notification to agent

  return await getServiceRequestById(id);
}


function getActionTypeForStatus(status: ServiceRequestStatus): ActionType {
  switch (status) {
    case ServiceRequestStatus.ASSIGNED:
      return ActionType.SERVICE_REQUEST_ASSIGNED;
    case ServiceRequestStatus.SCHEDULED:
      return ActionType.SERVICE_REQUEST_SCHEDULED;
    case ServiceRequestStatus.IN_PROGRESS:
      return ActionType.SERVICE_REQUEST_IN_PROGRESS;
    case ServiceRequestStatus.PAYMENT_PENDING:
      return ActionType.SERVICE_REQUEST_COMPLETED;
    case ServiceRequestStatus.COMPLETED:
      return ActionType.SERVICE_REQUEST_COMPLETED;
    case ServiceRequestStatus.CANCELLED:
      return ActionType.SERVICE_REQUEST_CANCELLED;
    default:
      return ActionType.SERVICE_REQUEST_CREATED;
  }
}
export async function scheduleServiceRequest(id: string, scheduledDate: string, user: any) {
  const fastify = getFastifyInstance();
  const sr = await getServiceRequestById(id);
  if (!sr) throw notFound('Service Request');

  // Permission: admin, franchise owner, or assigned agent
  let hasPermission = false;

  if (user.role === UserRole.ADMIN) {
    hasPermission = true;
  } else if (user.role === UserRole.SERVICE_AGENT && sr.assignedToId === user.userId) {
    hasPermission = true;
  } else if (user.role === UserRole.FRANCHISE_OWNER) {
    const franchise = await getFranchiseById(sr.franchiseId);
    hasPermission = franchise && franchise.ownerId === user.userId;
  }

  if (!hasPermission) throw forbidden('You do not have permission to schedule this service request');

  // Validate scheduled date is in the future
  const scheduledDateTime = new Date(scheduledDate);
  if (scheduledDateTime <= new Date()) {
    throw badRequest('Scheduled date must be in the future');
  }

  const oldStatus = sr.status;
  await fastify.db.update(serviceRequests).set({
    scheduledDate: scheduledDateTime.toISOString(),
    updatedAt: new Date().toISOString(),
  }).where(eq(serviceRequests.id, id));

  // Log action history
  await logActionHistory({
    serviceRequestId: id,
    actionType: ActionType.SERVICE_REQUEST_SCHEDULED,
    fromStatus: oldStatus,
    toStatus: ServiceRequestStatus.SCHEDULED,
    performedBy: user.userId,
    performedByRole: user.role,
    comment: `Service scheduled for ${scheduledDateTime.toLocaleDateString()}`,
    metadata: { scheduledDate: scheduledDateTime.toISOString() }
  });

  // Send push notifications
  await sendServiceRequestNotifications(sr, 'scheduled', user);

  return await getServiceRequestById(id);
}

// Get all unassigned service requests (non-installation)
export async function getAllUnassignedServiceRequests(user: any) {
  const fastify = getFastifyInstance();
  let whereConditions: any[] = [
    eq(serviceRequests.assignedToId, null), // Unassigned
    eq(serviceRequests.installationRequestId, null), // Not installation type
    inArray(serviceRequests.status, [ServiceRequestStatus.CREATED, ServiceRequestStatus.ASSIGNED])
  ];

  // For service agents, only show requests from their franchise
  if (user.role === UserRole.SERVICE_AGENT) {
    // Get agent's franchise assignments
    const agentFranchises = await fastify.db.query.franchiseAgents.findMany({
      where: eq(franchiseAgents.agentId, user.userId)
    });
    
    if (agentFranchises.length > 0) {
      const franchiseIds = agentFranchises.map(fa => fa.franchiseId);
      whereConditions.push(inArray(serviceRequests.franchiseId, franchiseIds));
    } else {
      return []; // Agent not assigned to any franchise
    }
  } else if (user.role === UserRole.FRANCHISE_OWNER) {
    const ownedFranchise = await fastify.db.query.franchises.findFirst({
      where: eq(franchises.ownerId, user.userId)
    });
    if (!ownedFranchise) return [];
    whereConditions.push(eq(serviceRequests.franchiseId, ownedFranchise.id));
  }

  const results = await fastify.db.query.serviceRequests.findMany({
    where: and(...whereConditions),
    with: {
      customer: true,
      product: true,
    },
    orderBy: (serviceRequests, { desc }) => [desc(serviceRequests.createdAt)],
  });

  // Format response according to requirements
  return results.map(sr => ({
    id: sr.id,
    description: sr.description,
    type: sr.type,
    priority: 'normal', // You might want to add priority to schema
    status: 'open',
    createdAt: sr.createdAt,
    customerName: sr.customer?.name || 'Unknown',
    customerAddress: sr.customer?.city || 'Not provided',
    customerPhone: sr.customer?.phone || 'Not provided',
  }));
}

// Assign service request to self (for service agents)
export async function assignServiceRequestToSelf(id: string, user: any) {
  const fastify = getFastifyInstance();
  const sr = await getServiceRequestById(id);
  if (!sr) throw notFound('Service Request');

  // Check if request is unassigned
  if (sr.assignedToId) {
    throw badRequest('Service request is already assigned');
  }

  // Check if it's not an installation type
  if (sr.installationRequestId) {
    throw badRequest('Installation service requests cannot be self-assigned');
  }

  // For service agents, check if they can work in this franchise
  if (user.role === UserRole.SERVICE_AGENT) {
    const agentFranchise = await fastify.db.query.franchiseAgents.findFirst({
      where: and(
        eq(franchiseAgents.agentId, user.userId),
        eq(franchiseAgents.franchiseId, sr.franchiseId),
        eq(franchiseAgents.isActive, true)
      )
    });
    
    if (!agentFranchise) {
      throw forbidden('You are not authorized to work in this franchise area');
    }
  }

  const oldStatus = sr.status;
  await fastify.db.update(serviceRequests).set({
    assignedToId: user.userId,
    status: ServiceRequestStatus.ASSIGNED,
    updatedAt: new Date().toISOString(),
  }).where(eq(serviceRequests.id, id));

  // Log action history
  await logActionHistory({
    serviceRequestId: id,
    actionType: ActionType.SERVICE_REQUEST_ASSIGNED,
    fromStatus: oldStatus,
    toStatus: ServiceRequestStatus.ASSIGNED,
    performedBy: user.userId,
    performedByRole: user.role,
    comment: `Service agent self-assigned`,
    metadata: { assignedToId: user.userId, selfAssigned: true }
  });

  // Send push notifications for reassignment
  await sendServiceRequestNotifications(sr, 'assigned', user);

  return await getServiceRequestById(id);
}

// Push notification helper function
async function sendServiceRequestNotifications(serviceRequest: any, action: string, user: any) {
  const fastify = getFastifyInstance();
  
  try {
    const notificationData = {
      referenceId: serviceRequest.id,
      referenceType: 'service_request'
    };

    switch (action) {
      case 'created':
        // Notify franchise owner, admins, and service agents in franchise
        const franchise = await fastify.db.query.franchises.findFirst({
          where: eq(franchises.id, serviceRequest.franchiseId),
          with: { owner: true }
        });

        // Notify franchise owner
        if (franchise?.owner?.pushNotificationToken) {
          await sendPushNotification(
            franchise.owner.pushNotificationToken,
            'New Service Request',
            `New ${serviceRequest.type} request from ${serviceRequest.customer?.name || 'customer'}`,
            notificationData
          );
        }

        // Notify admins
        const admins = await fastify.db.query.users.findMany({
          where: and(
            eq(users.role, UserRole.ADMIN),
            eq(users.isActive, true)
          )
        });

        for (const admin of admins) {
          if (admin.pushNotificationToken) {
            await sendPushNotification(
              admin.pushNotificationToken,
              'New Service Request',
              `New ${serviceRequest.type} request in ${franchise?.name || 'franchise'}`,
              notificationData
            );
          }
        }

        // Notify service agents in franchise
        const franchiseAgents = await fastify.db.query.franchiseAgents.findMany({
          where: and(
            eq(franchiseAgents.franchiseId, serviceRequest.franchiseId),
            eq(franchiseAgents.isActive, true)
          ),
          with: { agent: true }
        });

        for (const fa of franchiseAgents) {
          if (fa.agent?.pushNotificationToken) {
            await sendPushNotification(
              fa.agent.pushNotificationToken,
              'New Service Request Available',
              `New ${serviceRequest.type} request available for assignment`,
              notificationData
            );
          }
        }
        break;

      case 'completed':
      case 'scheduled':
        // Notify customer, assigned agent, franchise owner, and admins
        const recipients = [];

        // Customer
        if (serviceRequest.customer?.pushNotificationToken) {
          recipients.push({
            token: serviceRequest.customer.pushNotificationToken,
            title: `Service Request ${action === 'completed' ? 'Completed' : 'Scheduled'}`,
            message: `Your ${serviceRequest.type} request has been ${action === 'completed' ? 'completed' : 'scheduled'}`
          });
        }

        // Assigned agent
        if (serviceRequest.assignedAgent?.pushNotificationToken) {
          recipients.push({
            token: serviceRequest.assignedAgent.pushNotificationToken,
            title: `Service Request ${action === 'completed' ? 'Completed' : 'Scheduled'}`,
            message: `Service request ${serviceRequest.id} has been ${action === 'completed' ? 'completed' : 'scheduled'}`
          });
        }

        // Send notifications
        for (const recipient of recipients) {
          await sendPushNotification(recipient.token, recipient.title, recipient.message, notificationData);
        }
        break;

      case 'assigned':
        // Notify the assigned agent
        const assignedAgent = await fastify.db.query.users.findFirst({
          where: eq(users.id, serviceRequest.assignedToId)
        });

        if (assignedAgent?.pushNotificationToken) {
          await sendPushNotification(
            assignedAgent.pushNotificationToken,
            'Service Request Assigned',
            `You have been assigned a ${serviceRequest.type} service request`,
            notificationData
          );
        }
        break;
    }
  } catch (error) {
    console.error('Error sending push notifications:', error);
  }
}

// Helper function to send push notification
async function sendPushNotification(token: string, title: string, message: string, data: any) {
  const fastify = getFastifyInstance();
  
  if (!fastify.firebase) {
    console.warn('Firebase not configured, skipping push notification');
    return;
  }

  try {
    const payload = {
      notification: {
        title,
        body: message,
      },
      data: {
        ...data,
        type: 'service_request'
      },
      token: token
    };

    await fastify.firebase.messaging().send(payload);
  } catch (error) {
    console.error('Push notification error:', error);
  }
}