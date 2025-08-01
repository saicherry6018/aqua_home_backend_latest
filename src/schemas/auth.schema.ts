
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { UserRole } from '../types';






export const UserSchema = z.object({
    id: z.string(),
    phone: z.string(),
    name: z.string(),
    city: z.string(),
    alternativePhone: z.string().nullable().optional(),
    role: z.enum([
        UserRole.ADMIN,
        UserRole.CUSTOMER,
        UserRole.FRANCHISE_OWNER,
        UserRole.SERVICE_AGENT
    ]),
    hasOnboarded: z.boolean(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
});



//-------------------------------------------------------------------
//-------------------------------------------------------------------

export const LoginRequestSchema = z.object({
    idToken: z.string(),
    role: z.enum([
        UserRole.ADMIN,
        UserRole.CUSTOMER,
        UserRole.FRANCHISE_OWNER,
        UserRole.SERVICE_AGENT
    ]),
});


export const RefreshTokenRequestSchema = z.object({
    refreshToken: z.string(),
});
export const OnboardUserRequestSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    alternativePhone: z.string().regex(/^\d{10}$/, 'Alternative phone must be 10 digits').optional(),
    city: z.string()

});


//-------------------------------------------------------------------
//-------------------------------------------------------------------
export const RefreshTokenResponseSchema = z.object({
    accessToken: z.string(),
    user: UserSchema
});
export const OnboardUserResponseSchema = z.object({
    message: z.string(),
    user: UserSchema,
});
export const ErrorResponseSchema = z.object({
    statusCode: z.number(),
    error: z.string(),
    message: z.string(),
});

export const MeResponseSchema = z.object({
    user: UserSchema,
});

export const LoginResponseSchema = z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    user: UserSchema,
});


//-------------------------------------------------------------------
//-------------------------------------------------------------------
export const loginSchema = {
    body: zodToJsonSchema(LoginRequestSchema),
    response: {
        200: zodToJsonSchema(LoginResponseSchema),
        400: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["auth"],
    summary: "Login or register with Firebase ID token and role",
    description: "Login or register a user using a Firebase ID token from the frontend with specific role.",
};
export const onboardUserSchema = {
    body: zodToJsonSchema(OnboardUserRequestSchema),
    response: {
        200: zodToJsonSchema(OnboardUserResponseSchema),
        400: zodToJsonSchema(ErrorResponseSchema),
        401: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["auth"],
    summary: "Complete user onboarding",
    description: "Complete the onboarding process for an authenticated user",
    security: [{ bearerAuth: [] }],
};
export const refreshTokenSchema = {
    body: zodToJsonSchema(RefreshTokenRequestSchema),
    response: {
        200: zodToJsonSchema(RefreshTokenResponseSchema),
        401: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["auth"],
    summary: "Refresh access token using refresh token",
};

export const meSchema = {
    response: {
        200: zodToJsonSchema(MeResponseSchema),
        401: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["auth"],
    summary: "Get current authenticated user details",
};


export const checkRoleSchema = {
    querystring: zodToJsonSchema(z.object({
      phoneNumber: z.string(),
      role: z.enum([
        UserRole.ADMIN,
        UserRole.CUSTOMER,
        UserRole.FRANCHISE_OWNER,
        UserRole.SERVICE_AGENT
      ])
    })),
  
    response: {
      200: zodToJsonSchema(z.object({
        exists: z.boolean(),
        role: z.string().nullable(),
        userId: z.string().nullable()
      })),
      400: zodToJsonSchema(ErrorResponseSchema),
      403: zodToJsonSchema(ErrorResponseSchema),
      404: zodToJsonSchema(ErrorResponseSchema),
  
    },
    tags: ["auth"],
    summary: "Check if user exists with specific phone and role combination",
  }

