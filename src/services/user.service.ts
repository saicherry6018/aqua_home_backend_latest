import { eq, and, inArray } from "drizzle-orm";
import { User, users } from "../models/schema";
import { getFastifyInstance } from "../shared/fastify-instance";
import { notFound, forbidden } from "../utils/errors";
import { UserRole } from "../models/enums"; // Assuming UserRole enum is defined here

// Assume other models like franchises, subscriptions, installationRequests are also imported and available.
// For this example, I'll assume their presence and basic structure for demonstration.

// Placeholder for Franchise, Subscription, and InstallationRequest models if not imported elsewhere.
// In a real scenario, these would be properly imported from schema files.
// Example:
// import { Franchise, franchises } from "../models/schema";
// import { Subscription, subscriptions } from "../models/schema";
// import { InstallationRequest, installationRequests } from "../models/schema";


// Mock imports for demonstration if not present in the original file
// These would typically be imported from your schema definitions
const franchises = {
    id: 'franchiseId',
    ownerId: 'ownerId'
};
const subscriptions = {
    customerId: 'customerId',
    franchiseId: 'franchiseId'
};
const installationRequests = {
    customerId: 'customerId',
    franchiseId: 'franchiseId'
};


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

export async function getUserDetails(userId: string, requestingUser: any) {
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
  return userDetails;
}