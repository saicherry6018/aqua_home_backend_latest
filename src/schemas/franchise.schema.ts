import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ErrorResponseSchema, UserSchema } from './auth.schema';
import { UserRole } from '../types';


export const FranchiseAreaSchema = z.object({
  id: z.string(),
  name: z.string(),
  city:z.string(),
  geoPolygon: z.any(), // GeoJSON
  ownerId: z.string().optional().nullable(),
  isCompanyManaged: z.boolean(),
  createdAt: z.string(),
  isActive: z.boolean(),
  ownerName: z.string(),
  revenue:z.string(),
  serviceAgentCount:z.string()
});

const coordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

//-------------------------------------------------------------------
//-------------------------------------------------------------------

 
export const UpdateFranchiseAreaParamsSchema = z.object({
    id: z.string(),
  });

  export const AssignFranchiseOwnerParamsSchema = z.object({
    id: z.string(),
  });

  export const GetAllFranchiseAreasQuerySchema = z.object({
    isActive: z.boolean().optional(),
  });


  export const GetFranchiseAreaByIdParamsSchema = z.object({
    id: z.string(),
  });

  export const AssignServiceAgentParamsSchema = z.object({
    id: z.string(),
  });

  export const AssignServiceAgentBodySchema = z.object({
    agentId: z.string(),
  });
  
  
 
  export const GetServiceAgentsParamsSchema = z.object({
    id: z.string(),
  });
//-------------------------------------------------------------------
//-------------------------------------------------------------------




const CreateFranchiseAreaBodySchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    city: z.string().min(2, 'City must be at least 2 characters'),
    geoPolygon: z
      .array(coordinateSchema)
      .min(4, 'GeoPolygon must have at least 3 coordinates to form a valid area'),
    phoneNumber: z.string().optional(),
  });

  export const AssignFranchiseOwnerBodySchema = z.object({
    ownerId: z.string(),
  });

  //-------------------------------------------------------------------
//-------------------------------------------------------------------



const CreateFranchiseAreaResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
  geoPolygon: z.any(),
  isCompanyManaged: z.boolean(),
});


export const UpdateFranchiseAreaResponseSchema = z.object({
    message: z.string(),
    franchiseArea: FranchiseAreaSchema,
  });



export const GetAllFranchiseAreasResponseSchema = z.object({
    franchiseAreas: z.array(FranchiseAreaSchema),
  });



export const GetFranchiseAreaByIdResponseSchema = z.object({
    franchiseArea: FranchiseAreaSchema.extend({
        phoneNumber:z.string().nullable()
    }),
  });
 

  export const AssignFranchiseOwnerResponseSchema = z.object({
    message: z.string(),
    franchiseArea: FranchiseAreaSchema,
  });


export const GetServiceAgentsResponseSchema = z.object({
    agents: z.array(UserSchema),
  });
  
  export const AssignServiceAgentResponseSchema = z.object({
      message: z.string(),
      agent: UserSchema,
    });
    

//-------------------------------------------------------------------
//-------------------------------------------------------------------


export const createFranchiseAreaSchema = {
    body: zodToJsonSchema(CreateFranchiseAreaBodySchema),
    response: {
      201: zodToJsonSchema(CreateFranchiseAreaResponseSchema),
      400: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["franchise-areas"],
    summary: "Create a new franchise area",
    description: "Create a new franchise area (admin only)",
    security: [{ bearerAuth: [] }],
  };

  
  export const getAllFranchiseAreasSchema = {
    querystring: zodToJsonSchema(GetAllFranchiseAreasQuerySchema),
    response: {
      // 200: zodToJsonSchema(GetAllFranchiseAreasResponseSchema),
      400: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["franchise-areas"],
    summary: "Get all franchise areas",
    description: "Get a list of all franchise areas",
    security: [{ bearerAuth: [] }],
  };

  export const getFranchiseAreaByIdSchema = {
    params: zodToJsonSchema(GetFranchiseAreaByIdParamsSchema),
    response: {
      200: zodToJsonSchema(GetFranchiseAreaByIdResponseSchema),
      404: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["franchise-areas"],
    summary: "Get franchise area by ID",
    description: "Get a franchise area by its ID",
    security: [{ bearerAuth: [] }],
  };

  export const UpdateFranchiseAreaBodySchema = z.object({
    name: z.string().min(3).optional(),
    description: z.string().optional(),
    geoPolygon: z.any().optional(),
    isCompanyManaged: z.boolean().optional(),
    isActive: z.boolean().optional(),
    phoneNumber:z.string()
  });




export const updateFranchiseAreaSchema = {
  params: zodToJsonSchema(UpdateFranchiseAreaParamsSchema),
  body: zodToJsonSchema(UpdateFranchiseAreaBodySchema),
  response: {
    200: zodToJsonSchema(UpdateFranchiseAreaResponseSchema),
    400: zodToJsonSchema(ErrorResponseSchema),
    404: zodToJsonSchema(ErrorResponseSchema),
  },
  tags: ["franchise-areas"],
  summary: "Update a franchise area",
  description: "Update an existing franchise area (admin only)",
  security: [{ bearerAuth: [] }],
};

export const getServiceAgentsSchema = {
    params: zodToJsonSchema(GetServiceAgentsParamsSchema),
    response: {
      200: zodToJsonSchema(GetServiceAgentsResponseSchema),
      404: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["franchise-areas"],
    summary: "Get service agents for franchise area",
    description: "Get all service agents assigned to a franchise area",
    security: [{ bearerAuth: [] }],
  }; 

  export const assignServiceAgentSchema = {
    params: zodToJsonSchema(AssignServiceAgentParamsSchema),
    body: zodToJsonSchema(AssignServiceAgentBodySchema),
    response: {
      200: zodToJsonSchema(AssignServiceAgentResponseSchema),
      400: zodToJsonSchema(ErrorResponseSchema),
      404: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["franchise-areas"],
    summary: "Assign service agent",
    description: "Assign a service agent to a franchise area (admin or franchise owner only)",
    security: [{ bearerAuth: [] }],
  };



export const assignFranchiseOwnerSchema = {
  params: zodToJsonSchema(AssignFranchiseOwnerParamsSchema),
  body: zodToJsonSchema(AssignFranchiseOwnerBodySchema),
  response: {
    200: zodToJsonSchema(AssignFranchiseOwnerResponseSchema),
    400: zodToJsonSchema(ErrorResponseSchema),
    404: zodToJsonSchema(ErrorResponseSchema),
  },
  tags: ["franchise-areas"],
  summary: "Assign franchise owner",
  description: "Assign a franchise owner to a franchise area (admin only)",
  security: [{ bearerAuth: [] }],
};



