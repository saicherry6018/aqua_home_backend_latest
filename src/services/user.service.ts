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