
import { and, eq } from 'drizzle-orm';
import admin from 'firebase-admin';
import { franchises, User, users } from '../models/schema';
import { v4 as uuidv4 } from 'uuid';
import { UserRole } from '../types';
import { getFastifyInstance } from '../shared/fastify-instance';
import { badRequest, serverError, unauthorized } from '../utils/errors';
import * as userService from './user.service';
import { FastifyInstance } from 'fastify';


export async function loginWithFirebase(fastify: any, idToken: string, role: UserRole) {
    try {
        console.log('came here ')
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const db = fastify.db;
        const userFromFirebase = await admin.auth().getUser(decodedToken.uid);
        console.log('userFromFirebase ', userFromFirebase)
        if (!userFromFirebase) {
            throw new Error('User not found in Firebase');
        }

        // Check if user exists with specific phone and role combination
        let user = await db.query.users.findFirst({
            where: and(
                eq(users.phone, userFromFirebase.phoneNumber),
                eq(users.role, role)
            ),
        });
        const now = new Date();
        // If user doesn't exist with this phone-role combination, create a new user
        if (!user) {
            if (role === UserRole.CUSTOMER) {
                const userId = uuidv4();

                await db.insert(users).values({
                    id: userId,
                    email: userFromFirebase.email || '',
                    name: userFromFirebase.displayName || '',
                    phone: userFromFirebase.phoneNumber || '',
                    role: role,
                    firebaseUid: decodedToken.uid,
                    createdAt: now.toISOString(),
                    updatedAt: now.toISOString(),
                    isActive: true,

                });
                user = await db.query.users.findFirst({ where: eq(users.id, userId) });
            }
        } else {
            [user] = await db.update(users).set({
                firebaseUid: decodedToken.uid,
                updatedAt: now.toISOString()
            }).where(and(
                eq(users.phone, userFromFirebase.phoneNumber),
                eq(users.role, role)
            )).returning()
        }


        if (!user) {
            throw new Error('User not found after creation');
        }
        // Generate JWT tokens
        const tokens = await generateTokens(user);
        
        // If user is franchise owner, get their franchise area
        let franchiseId = null;
        if (user.role === UserRole.FRANCHISE_OWNER) {
            const franchise = await db.query.franchises.findFirst({
                where: eq(franchises.ownerId, user.id)
            });
            franchiseId = franchise?.id || null;
        }
        
        return {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            user,
            franchiseId,
        };
    } catch (error) {

        throw badRequest('Invalid Firebase ID token: ' + error);
    }
}


export function generateTokens(user: User): { accessToken: string; refreshToken: string } {
    const fastify = getFastifyInstance();

    if (!fastify.jwt) {
        throw new Error('JWT not initialized');
    }

    const accessTokenExpiry = process.env.JWT_ACCESS_EXPIRES_IN || '1h';
    const refreshTokenExpiry = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

    const payload = {
        userId: user.id,
        role: user.role

    };

    const accessToken = fastify.jwt.sign(payload, { expiresIn: accessTokenExpiry });
    const refreshToken = fastify.jwt.sign({ ...payload, type: 'refresh' }, { expiresIn: refreshTokenExpiry });

    return { accessToken, refreshToken };
}



export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string, user: User }> {
    const fastify = getFastifyInstance()

    if (!fastify?.jwt) {
        throw new Error('JWT not initialized');
    }

    try {
        // Verify the refresh token
        const decoded = fastify.jwt.verify(refreshToken) as jwt.JwtPayload;

        // Check if token is a refresh token
        if (!decoded.type || decoded.type !== 'refresh') {
            throw unauthorized('Invalid refresh token');
        }

        // Check if user exists
        const user = await userService.getUserById(decoded.userId);

        if (!user) {
            throw unauthorized('User not found');
        }

        // Check if user is still active
        if (!user.isActive) {
            throw unauthorized('User account is inactive');
        }

        // Generate new access token
        const accessTokenExpiry = process.env.JWT_ACCESS_EXPIRES_IN || '1h';
        const payload = {
            userId: user.id,
            role: user.role,
        };

        const accessToken = fastify.jwt.sign(payload, { expiresIn: accessTokenExpiry });

        return { accessToken, user };
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            throw unauthorized('Invalid refresh token');
        }
        throw error;
    }
}


export async function checkRole(phoneNumber: string, role: UserRole) {
    try {
        const fastify = getFastifyInstance() as FastifyInstance;
        const db = fastify.db;

        console.log('db here is ', db)

        const samplecall = await db.select().from(users);
        console.log('samplecall ', samplecall)
        const user = await db.query.users.findFirst({
            where: and(
                eq(users.phone, `+91` + phoneNumber),
                eq(users.role, role)
            )
        })

        if (user) {
            return {
                exists: true,
                role: user.role,
                userId: user.id
            }
        }

        return {
            exists: false,
            role: null,
            userId: null
        };


    } catch (error) {
        throw serverError('Something Went Wrong : ' + error);
    }

}