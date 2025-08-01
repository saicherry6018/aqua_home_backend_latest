import { FastifyRequest, FastifyReply } from "fastify";
import * as serviceRequestService from '../services/serviceRequests.service';
import * as installationRequestService from '../services/installation-request.service';
import { handleError, forbidden, notFound } from "../utils/errors";
import { ServiceRequestStatus, UserRole } from '../types';

// Get all service requests
export async function getAllServiceRequests(
  request: FastifyRequest<{ Querystring: any }>,
  reply: FastifyReply
) {
  try {
    const filters = request.query;
    const user = request.user;

    console.log('user is in service requests', user);
    const serviceRequests = await serviceRequestService.getAllServiceRequests(filters, user);
    return reply.code(200).send({ serviceRequests });
  } catch (error) {
    handleError(error, request, reply);
  }
}

// Get service request by ID
export async function getServiceRequestById(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const user = request.user;
    const sr = await serviceRequestService.getServiceRequestById(id);
    if (!sr) throw notFound('Service Request');

    console.log('service request', sr);
    console.log('user is', user);

    // Permission: admin, franchise owner (same franchise), assigned agent, or customer
    let hasPermission = false;

    if (user.role === UserRole.ADMIN) {
      hasPermission = true;
    } else if (user.role === UserRole.CUSTOMER && sr.customerId === user.userId) {
      hasPermission = true;
    } else if (user.role === UserRole.SERVICE_AGENT && sr.assignedToId === user.userId) {
      hasPermission = true;
    } else if (user.role === UserRole.FRANCHISE_OWNER) {
      // For franchise owner, we need to check if they own the franchise that handles this service request
      const userFromDb = await serviceRequestService.getUserById(user.userId);
      const franchise = await serviceRequestService.getFranchiseById(sr.franchiseId);
      hasPermission = userFromDb && franchise && franchise.ownerId === user.userId;
    }

    if (!hasPermission) throw forbidden('You do not have permission to view this service request');
    return reply.code(200).send({ serviceRequest: sr });
  } catch (error) {
    handleError(error, request, reply);
  }
}

export async function createServiceRequest(
  request: FastifyRequest<{
    Body: {
      subscriptionId?: string;
      productId: string;
      type: string;
      description: string;
      images?: string[];
      scheduledDate?: string;
      requiresPayment?: boolean;
      paymentAmount?: number;
    }
  }>,
  reply: FastifyReply
) {
  try {
    const user = request.user;

    // Handle form-data parsing
    const parts = request.parts();
    const fields: Record<string, any> = {};
    const images: string[] = [];

    for await (const part of parts) {
      if (part.file) {
        // This is a file field (likely "images")
        const filename = `service-requests/${Date.now()}-${part.filename}`;
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        // Upload to S3 if available
        if (request.server.uploadToS3) {
          const uploadedUrl = await request.server.uploadToS3(buffer, filename, part.mimetype);
          images.push(uploadedUrl);
        }
      } else {
        // This is a regular field
        fields[part.fieldname] = part.value;
      }
    }

    // Prepare service request data
    const serviceRequestData = {
      productId: fields.productId,
      subscriptionId: fields.subscriptionId || undefined,
      installationRequestId: fields.installationRequestId || undefined,
      type: fields.type,
      description: fields.description,
      scheduledDate: fields.scheduledDate || undefined,
      images: images,
      requiresPayment: fields.requiresPayment === 'true' || false,
      paymentAmount: fields.paymentAmount ? parseInt(fields.paymentAmount) : undefined
    };

    console.log('Service request data:', serviceRequestData);

    const sr = await serviceRequestService.createServiceRequest(serviceRequestData, user);
    return reply.code(201).send({ message: 'Service request created', serviceRequest: sr });
  } catch (error) {
    console.error('Error creating service request:', error);
    handleError(error, request, reply);
  }
}

// Create installation service request (for franchise_owner/admin)
export async function createInstallationServiceRequest(
  request: FastifyRequest<{ Body: { installationRequestId: string; assignedToId?: string; scheduledDate?: string; description?: string } }>,
  reply: FastifyReply
) {
  try {
    const user = request.user;
    const { installationRequestId, assignedToId, scheduledDate, description } = request.body;

    // Only admin or franchise owner can create installation service requests
    if (![UserRole.ADMIN, UserRole.FRANCHISE_OWNER].includes(user.role)) {
      throw forbidden('You do not have permission to create installation service requests');
    }

    const sr = await serviceRequestService.createInstallationServiceRequest({
      installationRequestId,
      assignedToId,
      scheduledDate,
      description: description || "Installation service request"
    }, user);

    return reply.code(201).send({ message: 'Installation service request created', serviceRequest: sr });
  } catch (error) {
    console.error('Error creating installation service request:', error);
    handleError(error, request, reply);
  }
}

// Update service request status
export async function updateServiceRequestStatus(
  request: FastifyRequest<{ Params: { id: string }; Body: { status: string; beforeImages?: string[]; afterImages?: string[] } }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const user = request.user;

    // Handle form-data parsing for image uploads
    const parts = request.parts();
    const fields: Record<string, any> = {};
    const beforeImages: string[] = [];
    const afterImages: string[] = [];

    for await (const part of parts) {
      if (part.file) {
        // Handle image file uploads
        const filename = `service-requests/${id}/${Date.now()}-${part.filename}`;
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        // Upload to S3 if available
        if (request.server.uploadToS3) {
          const uploadedUrl = await request.server.uploadToS3(buffer, filename, part.mimetype);
          
          // Categorize images based on field name
          if (part.fieldname === 'beforeImages') {
            beforeImages.push(uploadedUrl);
          } else if (part.fieldname === 'afterImages') {
            afterImages.push(uploadedUrl);
          }
        }
      } else {
        // Handle regular form fields
        fields[part.fieldname] = part.value;
      }
    }

    // Also check for images passed as arrays in the body (for non-multipart requests)
    const bodyImages = {
      beforeImages: fields.beforeImages ? JSON.parse(fields.beforeImages) : beforeImages,
      afterImages: fields.afterImages ? JSON.parse(fields.afterImages) : afterImages
    };

    const status = fields.status;
    const sr = await serviceRequestService.updateServiceRequestStatus(id, status, user, bodyImages);
    return reply.code(200).send({ message: 'Service request status updated', serviceRequest: sr });
  } catch (error) {
    handleError(error, request, reply);
  }
}

// Assign service agent
export async function assignServiceAgent(
  request: FastifyRequest<{ Params: { id: string }; Body: { assignedToId: string } }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const { assignedToId } = request.body;
    const user = request.user;
    const sr = await serviceRequestService.assignServiceAgent(id, assignedToId, user);
    return reply.code(200).send({ message: 'Service agent assigned', serviceRequest: sr });
  } catch (error) {
    handleError(error, request, reply);
  }
}

// Schedule service request
export async function scheduleServiceRequest(
  request: FastifyRequest<{ Params: { id: string }; Body: { scheduledDate: string } }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const { scheduledDate } = request.body;
    const user = request.user;

    const sr = await serviceRequestService.scheduleServiceRequest(id, scheduledDate, user);
    return reply.code(200).send({ message: 'Service request scheduled', serviceRequest: sr });
  } catch (error) {
    handleError(error, request, reply);
  }
}

export async function generateInstallationPaymentLink(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const serviceRequest = await serviceRequestService.getServiceRequestById(request.params.id);

    if (!serviceRequest) {
      throw notFound('Service request');
    }

    if (serviceRequest.type !== 'INSTALLATION' || !serviceRequest.installationRequestId) {
      throw forbidden('This endpoint is only for installation service requests');
    }

    if (serviceRequest.status !== 'PAYMENT_PENDING') {
      throw badRequest('Service request must be in PAYMENT_PENDING status to generate payment link');
    }

    // Check if user has permission (assigned agent, franchise owner, or admin)
    if (request.user.role === UserRole.SERVICE_AGENT && serviceRequest.assignedToId !== request.user.userId) {
      throw forbidden('You can only generate payment links for your assigned requests');
    }

    const result = await installationRequestService.generatePaymentLink(
      serviceRequest.installationRequestId,
      request.user
    );

    return reply.code(200).send(result);
  } catch (error) {
    handleError(error, request, reply);
  }
}

export async function refreshInstallationPaymentStatus(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const serviceRequest = await serviceRequestService.getServiceRequestById(request.params.id);

    if (!serviceRequest) {
      throw notFound('Service request');
    }

    if (serviceRequest.type !== 'INSTALLATION' || !serviceRequest.installationRequestId) {
      throw forbidden('This endpoint is only for installation service requests');
    }

    if (serviceRequest.status !== 'PAYMENT_PENDING') {
      throw badRequest('Service request must be in PAYMENT_PENDING status to refresh payment');
    }

    // Check if user has permission
    if (request.user.role === UserRole.SERVICE_AGENT && serviceRequest.assignedToId !== request.user.userId) {
      throw forbidden('You can only check payment status for your assigned requests');
    }

    const result = await installationRequestService.refreshPaymentStatus(
      serviceRequest.installationRequestId,
      request.user
    );

    // If payment is completed, update service request status
    if (result.paymentStatus === 'COMPLETED') {
      await serviceRequestService.updateServiceRequestStatus(
        request.params.id,
        'COMPLETED' as any,
        request.user
      );
    }

    return reply.code(200).send(result);
  } catch (error) {
    handleError(error, request, reply);
  }
}

export async function verifyInstallationPayment(
  request: FastifyRequest<{
    Params: { id: string };
    Body: {
      paymentMethod: 'CASH' | 'UPI';
      paymentImage: string;
      notes?: string;
    }
  }>,
  reply: FastifyReply
) {
  try {
    const serviceRequest = await serviceRequestService.getServiceRequestById(request.params.id);

    if (!serviceRequest) {
      throw notFound('Service request');
    }

    if (serviceRequest.type !== 'INSTALLATION' || !serviceRequest.installationRequestId) {
      throw forbidden('This endpoint is only for installation service requests');
    }

    if (serviceRequest.status !== 'PAYMENT_PENDING') {
      throw badRequest('Service request must be in PAYMENT_PENDING status to verify payment');
    }

    // Check if user has permission
    if (request.user.role === UserRole.SERVICE_AGENT && serviceRequest.assignedToId !== request.user.userId) {
      throw forbidden('You can only upload payment proof for your assigned requests');
    }

    const result = await installationRequestService.verifyPaymentAndComplete(
      serviceRequest.installationRequestId,
      {
        paymentMethod: request.body.paymentMethod,
        paymentImage: request.body.paymentImage
      },
      request.user
    );

    // Update service request status to completed
    await serviceRequestService.updateServiceRequestStatus(
      request.params.id,
      'COMPLETED' as any,
      request.user
    );

    return reply.code(200).send(result);
  } catch (error) {
    handleError(error, request, reply);
  }
}