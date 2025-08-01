// services/franchiseagent.service.ts
import { getFastifyInstance } from '../shared/fastify-instance';
import { franchiseAgents, users, franchises } from '../models/schema';
import { generateId } from '../utils/helpers';
import { sql, eq, and, inArray } from 'drizzle-orm';
import { notFound } from '../utils/errors';

export interface FranchiseAssignment {
    franchiseId: string;
    isPrimary?: boolean;
    role?: string;
}

export const assignAgentToFranchises = async (
    agentId: string, 
    assignments: FranchiseAssignment[]
) => {
    const db = getFastifyInstance().db;

    // Verify agent exists
    const agent = await db.query.users.findFirst({
        where: eq(users.id, agentId)
    });

    if (!agent) {
        throw notFound("Agent not found");
    }

    // Verify all franchises exist
    const franchiseIds = assignments.map(a => a.franchiseId);
    const existingFranchises = await db.query.franchises.findMany({
        where: inArray(franchises.id, franchiseIds)
    });

    if (existingFranchises.length !== franchiseIds.length) {
        throw new Error("One or more franchise IDs are invalid");
    }

    // Ensure only one primary assignment
    const primaryAssignments = assignments.filter(a => a.isPrimary);
    if (primaryAssignments.length > 1) {
        throw new Error("Agent can only have one primary franchise assignment");
    }

    // If making a new primary assignment, remove existing primary
    if (primaryAssignments.length === 1) {
        await db.update(franchiseAgents)
            .set({ isPrimary: false, updatedAt: sql`CURRENT_TIMESTAMP` })
            .where(and(
                eq(franchiseAgents.agentId, agentId),
                eq(franchiseAgents.isPrimary, true)
            ));
    }

    // Insert new assignments
    const assignmentRecords = assignments.map(assignment => ({
        id: generateId('fa'),
        franchiseId: assignment.franchiseId,
        agentId,
        role: assignment.role || 'SERVICE_AGENT',
        isPrimary: assignment.isPrimary || false,
        isActive: true
    }));

    await db.insert(franchiseAgents).values(assignmentRecords);

    return assignmentRecords;
};

export const removeAgentFromFranchise = async (agentId: string, franchiseId: string) => {
    const db = getFastifyInstance().db;

    const assignment = await db.query.franchiseAgents.findFirst({
        where: and(
            eq(franchiseAgents.agentId, agentId),
            eq(franchiseAgents.franchiseId, franchiseId)
        )
    });

    if (!assignment) {
        throw notFound("Franchise assignment not found");
    }

    await db.delete(franchiseAgents)
        .where(and(
            eq(franchiseAgents.agentId, agentId),
            eq(franchiseAgents.franchiseId, franchiseId)
        ));

    return { success: true };
};

export const updateFranchiseAssignment = async (
    agentId: string, 
    franchiseId: string, 
    updates: { isPrimary?: boolean; isActive?: boolean; role?: string }
) => {
    const db = getFastifyInstance().db;

    const assignment = await db.query.franchiseAgents.findFirst({
        where: and(
            eq(franchiseAgents.agentId, agentId),
            eq(franchiseAgents.franchiseId, franchiseId)
        )
    });

    if (!assignment) {
        throw notFound("Franchise assignment not found");
    }

    // If making this assignment primary, remove other primary assignments
    if (updates.isPrimary === true) {
        await db.update(franchiseAgents)
            .set({ isPrimary: false, updatedAt: sql`CURRENT_TIMESTAMP` })
            .where(and(
                eq(franchiseAgents.agentId, agentId),
                eq(franchiseAgents.isPrimary, true)
            ));
    }

    const updateData: any = { updatedAt: sql`CURRENT_TIMESTAMP` };
    if (updates.isPrimary !== undefined) updateData.isPrimary = updates.isPrimary;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;
    if (updates.role !== undefined) updateData.role = updates.role;

    await db.update(franchiseAgents)
        .set(updateData)
        .where(and(
            eq(franchiseAgents.agentId, agentId),
            eq(franchiseAgents.franchiseId, franchiseId)
        ));

    return { success: true };
};

export const getAgentFranchises = async (agentId: string) => {
    const db = getFastifyInstance().db;

    const assignments = await db
        .select({
            id: franchiseAgents.id,
            franchiseId: franchises.id,
            franchiseName: franchises.name,
            franchiseCity: franchises.city,
            role: franchiseAgents.role,
            isPrimary: franchiseAgents.isPrimary,
            isActive: franchiseAgents.isActive,
            assignedDate: franchiseAgents.assignedDate
        })
        .from(franchiseAgents)
        .leftJoin(franchises, eq(franchiseAgents.franchiseId, franchises.id))
        .where(eq(franchiseAgents.agentId, agentId))
        .orderBy(franchiseAgents.isPrimary, franchiseAgents.assignedDate);

    return assignments;
};

export const getFranchiseAgents = async (franchiseId: string) => {
    const db = getFastifyInstance().db;

    const agents = await db
        .select({
            id: users.id,
            name: users.name,
            phone: users.phone,
            role: users.role,
            isPrimary: franchiseAgents.isPrimary,
            isActive: franchiseAgents.isActive,
            assignedDate: franchiseAgents.assignedDate
        })
        .from(franchiseAgents)
        .leftJoin(users, eq(franchiseAgents.agentId, users.id))
        .where(eq(franchiseAgents.franchiseId, franchiseId))
        .orderBy(franchiseAgents.isPrimary, franchiseAgents.assignedDate);

    return agents;
};