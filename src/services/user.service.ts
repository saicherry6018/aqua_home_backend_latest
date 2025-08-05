import { eq } from "drizzle-orm";
import { User, users } from "../models/schema";
import { getFastifyInstance } from "../shared/fastify-instance";
import { notFound } from "../utils/errors";





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