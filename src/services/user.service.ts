import { eq, and, inArray } from "drizzle-orm";
import { franchises, installationRequests, subscriptions, User, users, serviceRequests, payments, products, franchiseAgents } from "../models/schema";
import { getFastifyInstance } from "../shared/fastify-instance";
import { notFound, forbidden } from "../utils/errors";
import { UserRole } from "../types";

// Frontend interfaces
interface Payment {
  id: string;
  amount: number;
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
  method: string;
  razorpayPaymentId?: string;
  paidDate?: string;
  dueDate: string;
}

interface Subscription {
  id: string;
  productId: string;
  productName: string;
  planType: 'MONTHLY' | 'YEARLY';
  status: 'ACTIVE' | 'INACTIVE' | 'EXPIRED';
  startDate: string;
  endDate: string;
  amount: number;
  franchiseId: string;
  franchiseName: string;
  payments: Payment[];
}

interface InstallationRequest {
  id: string;
  productId: string;
  productName: string;
  status: string;
  requestedDate: string;
  scheduledDate?: string;
  completedDate?: string;
  franchiseId: string;
  franchiseName: string;
  assignedAgent?: {
    id: string;
    name: string;
    phone: string;
  };
}

interface ServiceRequest {
  id: string;
  type: string;
  description: string;
  status: string;
  priority: string;
  createdAt: string;
  completedDate?: string;
  franchiseId: string;
  franchiseName: string;
  assignedAgent?: {
    id: string;
    name: string;
    phone: string;
  };
}

interface CustomerDetails {
  id: string;
  name: string;
  phone: string;
  email?: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  subscriptions: Subscription[];
  installationRequests: InstallationRequest[];
  serviceRequests: ServiceRequest[];
}

export async function onboardUser(
    userId: string,
    onboardData: {
        name: string;
        city: string,
        alternativePhone?: string;
    }
): Promise<User> {
    const fastify = getFastifyInstance();

    const user = await getUserById(userId);
    if (!user) {
        throw notFound('User');
    }

    const updateData: any = {
        name: onboardData.name,
        hasOnboarded: true,
        updatedAt: new Date().toISOString(),
        alternativePhone: onboardData.alternativePhone,
        city: onboardData.city
    };

    if (onboardData.alternativePhone) updateData.alternativePhone = onboardData.alternativePhone;

    const [userUpdated] = await fastify.db
        .update(users)
        .set(updateData)
        .where(eq(users.id, userId)).returning();

    return userUpdated;
}

export async function getUserById(id: string): Promise<User | null> {
    const fastify = getFastifyInstance();

    const result = await fastify.db.query.users.findFirst({
        where: eq(users.id, id),
    });

    if (!result) {
        return null;
    }

    return result;
}

export async function updateUser(userId: string, updateData: Partial<User>) {
  const fastify = getFastifyInstance();

  await fastify.db.update(users).set({
    ...updateData,
    updatedAt: new Date().toISOString()
  }).where(eq(users.id, userId));

  return getUserById(userId);
}

export async function registerPushNotificationToken(userId: string, token: string) {
  const fastify = getFastifyInstance();

  // Get current user to check existing token
  const user = await getUserById(userId);
  if (!user) throw notFound('User');

  // Check if token is the same as existing
  if (user.pushNotificationToken === token) {
    return {
      message: 'Push notification token is already registered',
      updated: false
    };
  }

  // Update the token
  await fastify.db.update(users).set({
    pushNotificationToken: token,
    updatedAt: new Date().toISOString()
  }).where(eq(users.id, userId));

  return {
    message: 'Push notification token registered successfully',
    updated: true
  };
}

export async function getUserDetails(userId: string, requestingUser: any): Promise<CustomerDetails> {
  const fastify = getFastifyInstance();

  // Permission checks
  if (requestingUser.role === UserRole.CUSTOMER) {
    // Customers can only view their own details
    if (requestingUser.userId !== userId) {
      throw forbidden('You can only view your own details');
    }
  } else if (requestingUser.role === UserRole.FRANCHISE_OWNER) {
    // Franchise owners can view details of users in their franchise area
    const targetUser = await fastify.db.query.users.findFirst({
      where: eq(users.id, userId)
    });

    if (!targetUser) {
      throw notFound('User');
    }

    // Check if the user belongs to the franchise owner's area
    const franchiseAreas = await fastify.db.query.franchises.findMany({
      where: eq(franchises.ownerId, requestingUser.userId)
    });

    const franchiseAreaIds = franchiseAreas.map(area => area.id);

    // Check if user has any subscriptions or installation requests in franchise owner's areas
    const hasAccess = await fastify.db.transaction(async (tx) => {
      const userSubscriptions = await tx.query.subscriptions.findMany({
        where: and(
          eq(subscriptions.customerId, userId),
          inArray(subscriptions.franchiseId, franchiseAreaIds)
        )
      });

      const userInstallations = await tx.query.installationRequests.findMany({
        where: and(
          eq(installationRequests.customerId, userId),
          inArray(installationRequests.franchiseId, franchiseAreaIds)
        )
      });

      return userSubscriptions.length > 0 || userInstallations.length > 0;
    });

    if (!hasAccess) {
      throw forbidden('You can only view details of users in your franchise area');
    }
  } else if (requestingUser.role !== UserRole.ADMIN) {
    // Only admins, franchise owners, and customers are allowed
    throw forbidden('You do not have permission to view user details');
  }

  // If all checks pass, proceed to fetch and return user details
  const userDetails = await getUserById(userId);
  if (!userDetails) {
    throw notFound('User');
  }

  // Fetch subscriptions with related data
  const userSubscriptions = await fastify.db.query.subscriptions.findMany({
    where: eq(subscriptions.customerId, userId),
    with: {
      product: true,
      franchise: true,
      payments: {
        where: eq(payments.subscriptionId, subscriptions.id)
      }
    }
  });

  // Fetch installation requests with related data
  const userInstallations = await fastify.db.query.installationRequests.findMany({
    where: eq(installationRequests.customerId, userId),
    with: {
      product: true,
      franchise: true,
      assignedTechnician: true
    }
  });

  // Fetch service requests with related data
  const userServiceRequests = await fastify.db.query.serviceRequests.findMany({
    where: eq(serviceRequests.customerId, userId),
    with: {
      product: true,
      franchise: true,
      assignedAgent: true
    }
  });

  // Format subscriptions
  const formattedSubscriptions: Subscription[] = userSubscriptions.map(sub => ({
    id: sub.id,
    productId: sub.productId,
    productName: sub.product?.name || 'Unknown Product',
    planType: 'MONTHLY', // Assuming monthly, you might need to derive this from your data
    status: sub.status as 'ACTIVE' | 'INACTIVE' | 'EXPIRED',
    startDate: sub.startDate,
    endDate: sub.endDate || '',
    amount: sub.monthlyAmount,
    franchiseId: sub.franchiseId,
    franchiseName: sub.franchise?.name || 'Unknown Franchise',
    payments: (sub.payments || []).map(payment => ({
      id: payment.id,
      amount: payment.amount,
      status: payment.status as 'COMPLETED' | 'PENDING' | 'FAILED',
      method: payment.paymentMethod,
      razorpayPaymentId: payment.razorpayPaymentId || undefined,
      paidDate: payment.paidDate || undefined,
      dueDate: payment.dueDate || ''
    }))
  }));

  // Format installation requests
  const formattedInstallations: InstallationRequest[] = userInstallations.map(install => ({
    id: install.id,
    productId: install.productId,
    productName: install.product?.name || 'Unknown Product',
    status: install.status,
    requestedDate: install.createdAt,
    scheduledDate: install.scheduledDate || undefined,
    completedDate: install.completedDate || undefined,
    franchiseId: install.franchiseId,
    franchiseName: install.franchiseName,
    assignedAgent: install.assignedTechnician ? {
      id: install.assignedTechnician.id,
      name: install.assignedTechnician.name || 'Unknown',
      phone: install.assignedTechnician.phone
    } : undefined
  }));

  // Format service requests
  const formattedServiceRequests: ServiceRequest[] = userServiceRequests.map(service => ({
    id: service.id,
    type: service.type,
    description: service.description,
    status: service.status,
    priority: 'MEDIUM', // You might need to add priority field to your schema or derive it
    createdAt: service.createdAt,
    completedDate: service.completedDate || undefined,
    franchiseId: service.franchiseId,
    franchiseName: service.franchise?.name || 'Unknown Franchise',
    assignedAgent: service.assignedAgent ? {
      id: service.assignedAgent.id,
      name: service.assignedAgent.name || 'Unknown',
      phone: service.assignedAgent.phone
    } : undefined
  }));

  // Return formatted customer details
  return {
    id: userDetails.id,
    name: userDetails.name || '',
    phone: userDetails.phone,
    email: undefined, // Add email field to your user schema if needed
    role: userDetails.role,
    isActive: userDetails.isActive,
    createdAt: userDetails.createdAt,
    subscriptions: formattedSubscriptions,
    installationRequests: formattedInstallations,
    serviceRequests: formattedServiceRequests
  };
}