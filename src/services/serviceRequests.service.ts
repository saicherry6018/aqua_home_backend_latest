import { FastifyInstance } from 'fastify';
import { eq, and, or, inArray } from 'drizzle-orm';
import { serviceRequests, users, products, subscriptions, installationRequests, franchises, payments } from '../models/schema';
import { ServiceRequestStatus, ServiceRequestType, UserRole, ActionType, InstallationRequestStatus } from '../types';
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

  // Get payment status for installation service requests
  let paymentStatus = null;
  if (result.type === 'INSTALLATION' && result.installationRequestId) {
    const installationRequest = await fastify.db.query.installationRequests.findFirst({
      where: eq(installationRequests.id, result.installationRequestId),
      with: { product: true }
    });

    if (installationRequest?.status === 'PAYMENT_PENDING') {
      const payment = await fastify.db.query.payments.findFirst({
        where: eq(payments.installationRequestId, result.installationRequestId)
      });
      
      paymentStatus = {
        status: payment?.status || 'PENDING',
        amount: installationRequest.orderType === 'RENTAL' ? installationRequest.product.deposit : installationRequest.product.buyPrice,
        method: payment?.paymentMethod,
        paidDate: payment?.paidDate,
        razorpayOrderId: installationRequest.razorpayOrderId
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
    paymentAmount: data.paymentAmount || null,
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

  // TODO: Send notification to admin/franchise owner

  return await getServiceRequestById(id);
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
    throw badRequest('Installation service request already exists for this installation request');
  }

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
    status: data.assignedToId ? ServiceRequestStatus.ASSIGNED : ServiceRequestStatus.CREATED,
    assignedToId: data.assignedToId || null,
    franchiseId: installationRequest.franchiseId,
    scheduledDate: data.scheduledDate || null,
    completedDate: null,
    beforeImages: null,
    afterImages: null,
    requiresPayment: false,
    paymentAmount: null,
    createdAt: now,
    updatedAt: now,
  };

  await fastify.db.insert(serviceRequests).values(serviceRequest);

  await fastify.db.update(installationRequests).set({
    status: InstallationRequestStatus.INSTALLATION_SCHEDULED,
    assignedTechnicianId: data.assignedToId
  }).where(eq(installationRequests.id, installationRequest.id))

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
  await logActionHistory(createServiceRequestStatusAction(
    id,
    undefined,
    serviceRequest.status,
    user.userId,
    user.role,
    { installationRequestId: data.installationRequestId, assignedToId: data.assignedToId }
  ));

  if (data.assignedToId) {
    await logActionHistory({
      serviceRequestId: id,
      actionType: ActionType.SERVICE_REQUEST_ASSIGNED,
      fromStatus: ServiceRequestStatus.CREATED,
      toStatus: ServiceRequestStatus.ASSIGNED,
      performedBy: user.userId,
      performedByRole: user.role,
      comment: `Service agent assigned during creation`,
      metadata: { assignedToId: data.assignedToId }
    });
  }

  // TODO: Send notification to customer and assigned agent (if any)

  return await getServiceRequestById(id);
}

// Update service request status
export async function updateServiceRequestStatus(id: string, status: ServiceRequestStatus, user: any, images?: { beforeImages?: string[]; afterImages?: string[] }) {
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

  if (!hasPermission) throw forbidden('You do not have permission to update this service request');

  const oldStatus = sr.status;
  const updateData: any = {
    status,
    updatedAt: new Date().toISOString(),
  };

  // Handle completion - check payment status for installation requests
  if (status === ServiceRequestStatus.COMPLETED) {
    // For installation service requests, ensure payment is completed before marking as completed
    if (sr.type === ServiceRequestType.INSTALLATION && sr.installationRequestId) {
      const installationRequest = await fastify.db.query.installationRequests.findFirst({
        where: eq(installationRequests.id, sr.installationRequestId)
      });
      
      if (installationRequest?.status !== InstallationRequestStatus.INSTALLATION_COMPLETED) {
        throw badRequest('Installation cannot be completed without payment verification. Use PAYMENT_PENDING status first.');
      }
    }
    updateData.completedDate = new Date().toISOString();
  }

  // Handle before/after images
  if (images?.beforeImages) {
    updateData.beforeImages = JSON.stringify(images.beforeImages);
  }
  if (images?.afterImages) {
    updateData.afterImages = JSON.stringify(images.afterImages);
  }

  await fastify.db.update(serviceRequests).set(updateData).where(eq(serviceRequests.id, id));

  // Handle installation request status sync for installation service requests
  if (sr.type === ServiceRequestType.INSTALLATION && sr.installationRequestId) {
    let installationStatus: InstallationRequestStatus | null = null;
    let installationActionType: ActionType | null = null;

    switch (status) {
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
    }

    if (installationStatus && installationActionType) {
      // Get current installation request status
      const currentInstallationRequest = await fastify.db.query.installationRequests.findFirst({
        where: eq(installationRequests.id, sr.installationRequestId)
      });

      // Update installation request status
      await fastify.db.update(installationRequests).set({
        status: installationStatus,
        updatedAt: new Date().toISOString(),
        ...(status === ServiceRequestStatus.COMPLETED && { completedDate: new Date().toISOString() })
      }).where(eq(installationRequests.id, sr.installationRequestId));

      // Log action history for installation request
      await logActionHistory({
        installationRequestId: sr.installationRequestId,
        actionType: installationActionType,
        fromStatus: currentInstallationRequest?.status,
        toStatus: installationStatus,
        performedBy: user.userId,
        performedByRole: user.role,
        comment: `Installation request status updated via service request ${status}`,
        metadata: { serviceRequestId: id, serviceRequestStatus: status }
      });
    }
  }

  // Log action history for service request
  const actionType = getActionTypeForStatus(status);
  await logActionHistory(createServiceRequestStatusAction(
    id,
    oldStatus,
    status,
    user.userId,
    user.role,
    {
      hasBeforeImages: !!images?.beforeImages,
      hasAfterImages: !!images?.afterImages
    }
  ));

  // TODO: Send notification to customer

  return await getServiceRequestById(id);
}

// Helper function to map status to action type
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

// Assign service agent
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

// Schedule service request
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
    status: ServiceRequestStatus.SCHEDULED,
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

  // TODO: Send notification to customer
  // TODO: If there's an assigned agent, notify them too

  return await getServiceRequestById(id);
}