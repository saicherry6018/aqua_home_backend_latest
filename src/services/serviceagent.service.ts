// services/serviceagent.service.ts
import { getFastifyInstance } from '../shared/fastify-instance';
import { serviceAgentAddBody } from '../schemas/serviceagent.schema';
import { z } from 'zod';
import { franchises, franchiseAgents, installationRequests, serviceRequests, users } from '../models/schema';
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

    const agentId = await generateId('agent');

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

    if (filters?.id) {
        whereConditions.push(eq(users.id, filters.id));
    }

    if (filters?.city) {
        whereConditions.push(eq(users.city, filters.city));
    }

    if (filters?.isActive !== undefined) {
        whereConditions.push(eq(users.isActive, filters.isActive));
    }

    // Base query with franchise information through mapping table
    let query = db
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
        })
        .from(users)
        .leftJoin(franchiseAgents, and(
            eq(franchiseAgents.agentId, users.id),
            eq(franchiseAgents.isActive, true)
        ))
        .leftJoin(franchises, eq(franchiseAgents.franchiseId, franchises.id))
        .leftJoin(serviceRequests, eq(serviceRequests.assignedToId, users.id))
        .leftJoin(installationRequests, eq(installationRequests.assignedTechnicianId, users.id))
        .where(and(...whereConditions));

    // If filtering by franchiseId, add that condition
    if (filters?.franchiseId) {
        query = query.where(and(...whereConditions, eq(franchiseAgents.franchiseId, filters.franchiseId)));
    }

    const agents = await query.groupBy(users.id, franchises.id);

    console.log('Service agents retrieved:', agents);
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
