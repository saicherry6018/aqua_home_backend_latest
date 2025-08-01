import z from "zod";
import zodToJsonSchema from "zod-to-json-schema";
import { ErrorResponseSchema } from "./auth.schema";

export const assignAgentBody = z.object({
    agentId: z.string().min(1, "Agent ID is required"),
    assignments: z.array(z.object({
        franchiseId: z.string().min(1, "Franchise ID is required"),
        isPrimary: z.boolean().optional().default(false),
        role: z.string().optional().default("SERVICE_AGENT")
    })).min(1, "At least one franchise assignment is required")
});

export const serviceAgentAddBody = z.object({
    name: z.string(),
    number: z.string(),
    email: z.string().email().optional(),
    address: z.string().optional(),
    alternativeNumber: z.string().optional(),
    franchiseId: z.string().optional()

})


export const updateAssignmentBody = z.object({
    isPrimary: z.boolean().optional(),
    isActive: z.boolean().optional(),
    role: z.string().optional()
});

export const assignAgentSchema = {
    body: zodToJsonSchema(assignAgentBody),
    response: {
        201: zodToJsonSchema(z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.array(z.object({
                id: z.string(),
                franchiseId: z.string(),
                agentId: z.string(),
                role: z.string(),
                isPrimary: z.boolean()
            }))
        })),
        400: zodToJsonSchema(ErrorResponseSchema),
        403: zodToJsonSchema(ErrorResponseSchema),
        404: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["Franchise Agents"],
    summary: "Assign agent to franchises",
    security: [{ bearerAuth: [] }],
};

export const removeAgentSchema = {
    params: zodToJsonSchema(z.object({
        agentId: z.string(),
        franchiseId: z.string()
    })),
    response: {
        200: zodToJsonSchema(z.object({
            success: z.boolean(),
            message: z.string()
        })),
        400: zodToJsonSchema(ErrorResponseSchema),
        403: zodToJsonSchema(ErrorResponseSchema),
        404: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["Franchise Agents"],
    summary: "Remove agent from franchise",
    security: [{ bearerAuth: [] }],
};

export const updateAssignmentSchema = {
    params: zodToJsonSchema(z.object({
        agentId: z.string(),
        franchiseId: z.string()
    })),
    body: zodToJsonSchema(updateAssignmentBody),
    response: {
        200: zodToJsonSchema(z.object({
            success: z.boolean(),
            message: z.string()
        })),
        400: zodToJsonSchema(ErrorResponseSchema),
        403: zodToJsonSchema(ErrorResponseSchema),
        404: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["Franchise Agents"],
    summary: "Update franchise assignment",
    security: [{ bearerAuth: [] }],
};

export const getAgentFranchisesSchema = {
    params: zodToJsonSchema(z.object({
        agentId: z.string()
    })),
    response: {
        200: zodToJsonSchema(z.array(z.object({
            id: z.string(),
            franchiseId: z.string(),
            franchiseName: z.string(),
            franchiseCity: z.string(),
            role: z.string(),
            isPrimary: z.boolean(),
            isActive: z.boolean(),
            assignedDate: z.string()
        }))),
        400: zodToJsonSchema(ErrorResponseSchema),
        403: zodToJsonSchema(ErrorResponseSchema),
        404: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["Franchise Agents"],
    summary: "Get agent's franchise assignments",
    security: [{ bearerAuth: [] }],
};

export const getFranchiseAgentsSchema = {
    params: zodToJsonSchema(z.object({
        franchiseId: z.string()
    })),
    response: {
        200: zodToJsonSchema(z.array(z.object({
            id: z.string(),
            name: z.string(),
            phone: z.string(),
            role: z.string(),
            isPrimary: z.boolean().default(true),
            isActive: z.boolean(),
            assignedDate: z.string()
        }))),
        400: zodToJsonSchema(ErrorResponseSchema),
        403: zodToJsonSchema(ErrorResponseSchema),
        404: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["Franchise Agents"],
    summary: "Get franchise's assigned agents",
    security: [{ bearerAuth: [] }],
};
export const addServiceAgentSchema = {
    body: zodToJsonSchema(
        serviceAgentAddBody
    ),
    response: {

        400: zodToJsonSchema(ErrorResponseSchema),
        403: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["Service Agents"],
    summary: "adding service agent",

    security: [{ bearerAuth: [] }],

}


export const getServcieAgentsSchema = {
    querystring: zodToJsonSchema(z.object({
        id:z.string().optional()
    })),
    response: {
        200: zodToJsonSchema(
            z.array(
                z.object({
                    name: z.string(),
                    number: z.string(),
                    franchiseName: z.string(),
                    franchiseId: z.string(),
                    serviceRequestsCount: z.number(),
                    active: z.boolean(),
                    joined: z.string(),
                    installationRequestsCount:z.number(),
                    id:z.string(),
                    alternativePhone:z.string()

                })

            )
        ),
        400: zodToJsonSchema(ErrorResponseSchema),
        403: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["Service Agents"],
    summary: "adding service agent",

    security: [{ bearerAuth: [] }],

}

