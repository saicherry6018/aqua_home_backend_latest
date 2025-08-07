// services/serviceagent.service.ts
import { getFastifyInstance } from '../shared/fastify-instance';
import { serviceAgentAddBody } from '../schemas/serviceagent.schema';
import { z } from 'zod';
import { franchises, franchiseAgents, installationRequests, serviceRequests, users, payments } from '../models/schema';
import { generateId } from '../utils/helpers';
import { UserRole } from '../types';
import { sql, eq, and, isNull } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { notFound } from '../utils/errors';
import { assignAgentToFranchises } from './franchise-agent.service';

type ServiceAgentInput = z.infer<typeof serviceAgentAddBody>;


export const serviceAgentAddToDB = async (data: ServiceAgentInput) => {
    const db = getFastifyInstance().db;

    console.log('Adding service agent with data:', data);

    // Check if phone number already exists for SERVICE_AGENT role
    const existingAgent = await db.query.users.findFirst({
        where: and(
            eq(users.phone, data.number),
            eq(users.role, UserRole.SERVICE_AGENT)
        )
    });

    if (existingAgent) {
        throw new Error('Service agent with this phone number already exists');
    }

    const agentId = uuidv4();

    // Create the user record
    await db.insert(users).values({
        id: agentId,
        name: data.name,
        phone: data.number,
        alternativePhone: data.alternativeNumber || null,
        role: UserRole.SERVICE_AGENT,
        isActive: true,
        hasOnboarded: true
    });

    // If franchiseId is provided, assign agent to franchise
    if (data.franchiseId) {
        await assignAgentToFranchises(agentId, [{
            franchiseId: data.franchiseId,
            isPrimary: true, // First assignment is primary
            role: 'SERVICE_AGENT'
        }]);
    }

    return {
        id: agentId,
        name: data.name,
        phone: data.number
    };
};
export const getAllServiceAgentsFromDB = async (filters?: {
    id?: string;
    franchiseId?: string;
    city?: string;
    isActive?: boolean;
}) => {
    const db = getFastifyInstance().db;

    let whereConditions = [eq(users.role, UserRole.SERVICE_AGENT)];

    if (filters?.city) {
        whereConditions.push(eq(users.city, filters.city));
    }

    if (filters?.isActive !== undefined) {
        whereConditions.push(eq(users.isActive, filters.isActive));
    }

    // Additional conditions for the franchise join
    let franchiseJoinConditions = [
        eq(franchiseAgents.agentId, users.id),
        eq(franchiseAgents.isActive, true)
    ];

    // If filtering by specific agent id, add to franchise join conditions
    if (filters?.id) {
        franchiseJoinConditions.push(eq(franchiseAgents.agentId, filters.id));
    }

    // If filtering by franchiseId, add to franchise join conditions
    if (filters?.franchiseId) {
        franchiseJoinConditions.push(eq(franchiseAgents.franchiseId, filters.franchiseId));
    }

    // Build the query
    const query = db
        .select({
            id: users.id,
            name: users.name,
            number: users.phone,
            alternativePhone: users.alternativePhone,
            franchiseName: franchises.name,
            franchiseId: franchises.id,
            isPrimaryFranchise: franchiseAgents.isPrimary,
            serviceRequestsCount: sql<number>`COUNT(DISTINCT ${serviceRequests.id})`,
            installationRequestsCount: sql<number>`COUNT(DISTINCT ${installationRequests.id})`,
            active: users.isActive,
            joined: users.createdAt,
            agentId: franchiseAgents.agentId
        })
        .from(users)
        .leftJoin(franchiseAgents, and(...franchiseJoinConditions))
        .leftJoin(franchises, eq(franchiseAgents.franchiseId, franchises.id))
        .leftJoin(serviceRequests, eq(serviceRequests.assignedToId, users.id))
        .leftJoin(installationRequests, eq(installationRequests.assignedTechnicianId, users.id))
        .where(and(...whereConditions))
        .groupBy(users.id, franchises.id);

    const agents = await query;

    console.log('Service agents retrieved:', agents);

    if (filters?.id) {
        return agents.filter(agent => agent.agentId === filters?.id)
    }
    return agents;
};

export const serviceAgentUpdateInDB = async (id: string, data: {
    name: String;
    number: String;
    alternativeNumber: String;
    isActive: String
    franchiseId: String

}) => {
    const db = getFastifyInstance().db;

    console.log('id  patch ', id)
    console.log('data ', data)
    // Check if agent exists
    const agent = await db.query.users.findFirst({
        where: and(
            eq(users.id, id),
            eq(users.role, UserRole.SERVICE_AGENT)
        )
    });

    if (!agent) {
        throw notFound("Service agent not found, unable to update");
    }

    const updateData: any = {
        updatedAt: sql`CURRENT_TIMESTAMP`
    };

    if (data.name) updateData.name = data.name;
    if (data.number) updateData.phone = data.number;
    if (data.alternativeNumber !== undefined) updateData.alternativePhone = data.alternativeNumber;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    if (data.franchiseId) {
        const frnachise = await db.query.franchises.findFirst({
            where: eq(franchises.id, data.franchiseId)
        })

        if (!frnachise) {
            throw notFound("Franchise ")
        }
    }


    await db.transaction(async (tx) => {

        // Check if phone number is being updated and if it conflicts
        if (data.number) {

            if (data.number !== agent.phone) {
                const existingAgent = await tx.query.users.findFirst({
                    where: and(
                        eq(users.phone, data.number),
                        eq(users.role, UserRole.SERVICE_AGENT)
                    )
                });

                console.log('existingAgent ', existingAgent)

                if (existingAgent && existingAgent.id !== id) {
                    throw new Error('Another service agent with this phone number already exists');
                }
                const rowToDelete = await tx.query.franchiseAgents.findFirst({
                    where: eq(franchiseAgents.agentId, id),
                });

                if (rowToDelete) {
                    await tx.delete(franchiseAgents).where(eq(franchiseAgents.agentId, id));
                }
                await tx.insert(franchiseAgents).values({
                    id: uuidv4(),
                    franchiseId: data.franchiseId ? data.franchiseId : rowToDelete.franchiseId,
                    agentId: id,

                })
            }


            await tx.update(users).set(updateData).where(eq(users.id, id));


        }

        if (data.franchiseId) {
            await tx.update(franchiseAgents).set({
                franchiseId: data.franchiseId
            })
        }

    })

    // Return updated agent data
    const updatedAgent = await db.query.users.findFirst({
        where: eq(users.id, id),
        columns: {
            id: true,
            name: true,
            phone: true,
            email: true,
            isActive: true
        }
    });

    return updatedAgent;
};
export const getAgentDashboard = async (agentId: string) => {
    const db = getFastifyInstance().db;

    // Get agent details
    const agent = await db.query.users.findFirst({
        where: and(
            eq(users.id, agentId),
            eq(users.role, UserRole.SERVICE_AGENT)
        )
    });

    if (!agent) {
        throw notFound("Service agent not found");
    }

    // Get franchise assignments
    const franchiseAssignments = await db.query.franchiseAgents.findMany({
        where: and(
            eq(franchiseAgents.agentId, agentId),
            eq(franchiseAgents.isActive, true)
        ),
        with: {
            franchise: true
        }
    });

    // Get service requests with detailed information
    const serviceRequestsQuery = await db
        .select({
            id: serviceRequests.id,
            description: serviceRequests.description,
            type: serviceRequests.type,
            status: serviceRequests.status,

            createdAt: serviceRequests.createdAt,
            updatedAt: serviceRequests.updatedAt,
            scheduledDate: serviceRequests.scheduledDate,
            customerName: users.name,
            customerPhone: users.phone,
            franchiseName: franchises.name,
            franchiseId: franchises.id,
            requiresPayment: serviceRequests.requirePayment,

            beforeImages: serviceRequests.beforeImages ?
                (typeof serviceRequests.beforeImages === 'string' ?
                    JSON.parse(serviceRequests.beforeImages) :
                    serviceRequests.beforeImages) : [],
            afterImages: serviceRequests.afterImages ?
                (typeof serviceRequests.afterImages === 'string' ?
                    JSON.parse(serviceRequests.afterImages) :
                    serviceRequests.afterImages) : []
        })
        .from(serviceRequests)
        .leftJoin(users, eq(serviceRequests.customerId, users.id))
        .leftJoin(franchises, eq(serviceRequests.franchiseId, franchises.id))
        .where(eq(serviceRequests.assignedToId, agentId))
        .orderBy(sql`${serviceRequests.createdAt} DESC`);

    // Calculate statistics
    const stats = await db.transaction(async (tx) => {
        const totalRequests = await tx
            .select({ count: sql<number>`COUNT(*)` })
            .from(serviceRequests)
            .where(eq(serviceRequests.assignedToId, agentId));

        const completedRequests = await tx
            .select({ count: sql<number>`COUNT(*)` })
            .from(serviceRequests)
            .where(and(
                eq(serviceRequests.assignedToId, agentId),
                eq(serviceRequests.status, 'COMPLETED')
            ));

        const pendingRequests = await tx
            .select({ count: sql<number>`COUNT(*)` })
            .from(serviceRequests)
            .where(and(
                eq(serviceRequests.assignedToId, agentId),
                eq(serviceRequests.status, 'ASSIGNED')
            ));

        const inProgressRequests = await tx
            .select({ count: sql<number>`COUNT(*)` })
            .from(serviceRequests)
            .where(and(
                eq(serviceRequests.assignedToId, agentId),
                eq(serviceRequests.status, 'IN_PROGRESS')
            ));

        const thisMonthRequests = await tx
            .select({ count: sql<number>`COUNT(*)` })
            .from(serviceRequests)
            .where(and(
                eq(serviceRequests.assignedToId, agentId),
                sql`strftime('%Y-%m', ${serviceRequests.createdAt}) = strftime('%Y-%m', 'now')`
            ));

        // Fixed revenue query - using proper Drizzle ORM syntax
        const revenueQuery = await tx
            .select({
                totalRevenue: sql<number>`COALESCE(SUM(${payments.amount}), 0)`
            })
            .from(payments)
            .innerJoin(serviceRequests, eq(payments.serviceRequestId, serviceRequests.id))
            .where(and(
                eq(payments.status, 'completed'),
                eq(serviceRequests.assignedToId, agentId)
            ));

        return {
            totalRequests: totalRequests[0]?.count || 0,
            completedRequests: completedRequests[0]?.count || 0,
            pendingRequests: pendingRequests[0]?.count || 0,
            inProgressRequests: inProgressRequests[0]?.count || 0,
            thisMonthRequests: thisMonthRequests[0]?.count || 0,
            totalRevenue: revenueQuery[0]?.totalRevenue || 0,
            completionRate: totalRequests[0]?.count > 0
                ? Math.round((completedRequests[0]?.count / totalRequests[0]?.count) * 100)
                : 0
        };
    });

    const data = {
        agent: {
            id: agent.id,
            name: agent.name,
            phone: agent.phone,
            alternativePhone: agent.alternativePhone,
            email: agent.email,
            isActive: agent.isActive,
            joinedDate: agent.createdAt
        },
        franchiseAssignments: franchiseAssignments.map(fa => ({
            franchiseId: fa.franchiseId,
            franchiseName: fa.franchise?.name,
            franchiseCity: fa.franchise?.city,
            isPrimary: fa.isPrimary,
            assignedDate: fa.createdAt
        })),
        statistics: stats,
        serviceRequests: {
            all: serviceRequestsQuery,
            recent: serviceRequestsQuery.slice(0, 10) // Last 10 requests
        }
    }


    console.log('data dashbaord ',data)

    // Return in the same format as the original function would have
    return {
        agent: {
            id: agent.id,
            name: agent.name,
            phone: agent.phone,
            alternativePhone: agent.alternativePhone,
            email: agent.email,
            isActive: agent.isActive,
            joinedDate: agent.createdAt
        },
        franchiseAssignments: franchiseAssignments.map(fa => ({
            franchiseId: fa.franchiseId,
            franchiseName: fa.franchise?.name,
            franchiseCity: fa.franchise?.city,
            isPrimary: fa.isPrimary,
            assignedDate: fa.createdAt
        })),
        statistics: stats,
        serviceRequests: {
            all: serviceRequestsQuery,
            recent: serviceRequestsQuery.slice(0, 10) // Last 10 requests
        }
    };
};