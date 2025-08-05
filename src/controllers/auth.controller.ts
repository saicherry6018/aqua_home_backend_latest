import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as authService from '../services/auth.service';
import { handleError, notFound } from "../utils/errors";
import * as userService from '../services/user.service'
import { UserRole } from "@/types";


export async function login(
    request: FastifyRequest<{ Body: { idToken: string; role: UserRole } }>,
    reply: FastifyReply
) {
    try {
        const { idToken, role } = request.body;
        const result = await authService.loginWithFirebase(request.server, idToken, role);
        console.log('result ',result)
        return reply.code(200).send(result);
    } catch (error) {

        handleError(error, request, reply);
    }


}

export async function onboard(request: FastifyRequest<{
    Body: {
        name: string,
        city: string,
        alternativePhone: string
    }
}>, reply: FastifyReply) {

    try {

        const { name, alternativePhone, city } = request.body;
        const userId = request.user.userId;

        const updatedUser = await userService.onboardUser(userId, {
            name,
            alternativePhone,
            city

        });

        return reply.code(200).send({
            message: 'User onboarding completed successfully',
            user: updatedUser
        });

    } catch (e) {
        handleError(e, request, reply)
    }

}

export async function refreshToken(
    request: FastifyRequest<{ Body: { refreshToken: string } }>,
    reply: FastifyReply
) {
    try {
        const { refreshToken } = request.body;
        const result = await authService.refreshAccessToken(refreshToken);

        return reply.code(200).send(result);
    } catch (error) {
        handleError(error, request, reply);
    }
}


export async function me(
    request: FastifyRequest,
    reply: FastifyReply
) {
    try {
        // Get the full user object from database using the userId from JWT
        const user = await userService.getUserById(request.user.userId);

        if (!user) {
            throw notFound('User');
        }

        return reply.code(200).send({ user });
    } catch (error) {
        handleError(error, request, reply);
    }
}


export async function checkRole(
    request: FastifyRequest<{
      Querystring: { phoneNumber: string; role: UserRole }
    }>,
    reply: FastifyReply
  ) {

    try {

      console.log("request.query is ",request.query)

      const { phoneNumber, role } = request.query;

      const result = await authService.checkRole(phoneNumber, role)
      return reply.code(200).send(result)


    } catch (error) {
      handleError(error, request, reply)
  }

}

export async function updateMeController(
  request: FastifyRequest<{ Body: { name?: string; alternativePhone?: string; city?: string } }>,
  reply: FastifyReply
) {
  try {
    const user = request.user;
    const updateData = request.body;

    const updatedUser = await userService.updateUser(user.userId, updateData);

    reply.code(200).send({
      message: 'Profile updated successfully',
      user: updatedUser
    });
  } catch (error) {
    handleError(error, request, reply);
  }
}

export async function registerPushToken(
  request: FastifyRequest<{ Body: { token: string } }>,
  reply: FastifyReply
) {
  try {
    const user = request.user;
    const { token } = request.body;

    const result = await userService.registerPushNotificationToken(user.userId, token);

    reply.code(200).send({
      message: result.message,
      tokenUpdated: result.updated
    });
  } catch (error) {
    handleError(error, request, reply);
  }
}