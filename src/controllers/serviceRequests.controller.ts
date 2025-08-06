import { FastifyRequest, FastifyReply } from "fastify";
import * as serviceRequestService from '../services/serviceRequests.service';
import * as installationRequestService from '../services/installation-request.service';
import { handleError, forbidden, notFound, badRequest } from "../utils/errors";
import { ServiceRequestStatus, ServiceRequestType, UserRole } from '../types';
import { notificationService } from '../services/notification.service';


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

    // Send notification to the assigned agent if available
    if (sr.assignedToId) {
      const assignedAgent = await serviceRequestService.getUserById(sr.assignedToId);
      if (assignedAgent && assignedAgent.pushNotificationToken) {
        await notificationService.sendSinglePushNotification({
          pushToken: assignedAgent.pushNotificationToken,
          title: 'New Service Request Assigned',
          message: `A new service request #${sr.id} has been assigned to you.`,
          data: { serviceRequestId: sr.id, type: 'NEW_ASSIGNMENT', screen: `/service-requests/${sr.id}` },
        });
      }
    }

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


    console.log('data in crete installtion requests is ',request.body)

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

    console.log('sr in createInstallationServiceRequest after ',sr)

    // Send notification to the assigned agent if available
    if (sr.assignedToId) {
      const assignedAgent = await serviceRequestService.getUserById(sr.assignedToId);
      if (assignedAgent && assignedAgent.pushNotificationToken) {
        await notificationService.sendSinglePushNotification({
          pushToken: assignedAgent.pushNotificationToken,
          title: 'New Installation Service Request',
          message: `A new installation service request #${sr.id} has been assigned to you.`,
          data: { serviceRequestId: sr.id, type: 'NEW_INSTALLATION_ASSIGNMENT', screen: `/service-requests/${sr.id}` },
        });
      }
    }


    return reply.code(201).send({ message: 'Installation service request created', serviceRequest: sr });
  } catch (error) {
    console.error('Error creating installation service request:', error);
    handleError(error, request, reply);
  }
}

// Update service request status
export async function updateServiceRequestStatus(
  request: FastifyRequest<{
    Params: { id: string };
    Body: {
      status: ServiceRequestStatus;
      agentId?: string;
      scheduledDate?: string;
      paymentAmount?: number;
      beforeImages?: string[];
      afterImages?: string[];
    };
  }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
 
    const user = request.user as any;

     const parts = request.parts();
      const fields: Record<string, any> = {};
      const beforeImages: string[] = [];
      const afterImages: string[] = [];

      for await (const part of parts) {
        if (part.file) {
          const filename = `service-requests/${id}/${Date.now()}-${part.filename}`;
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          const buffer = Buffer.concat(chunks);

          if (request.server.uploadToS3) {
            const uploadedUrl = await request.server.uploadToS3(buffer, filename, part.mimetype);
            if (part.fieldname === 'beforeImages') {
              beforeImages.push(uploadedUrl);
            } else if (part.fieldname === 'afterImages') {
              afterImages.push(uploadedUrl);
            }
          }
        } else {
          fields[part.fieldname] = part.value;
        }
      }

      // Combine images from body and uploaded
      const bodyImages = {
        beforeImages: fields.beforeImages ? JSON.parse(fields.beforeImages) : beforeImages,
        afterImages: fields.afterImages ? JSON.parse(fields.afterImages) : afterImages
      };

      // Merge all fields to send to service
      const updatePayload = {
        ...fields,
        beforeImages: bodyImages.beforeImages,
        afterImages: bodyImages.afterImages
      };

      console.log('Final update payload:', updatePayload);

      const result = await serviceRequestService.updateServiceRequestStatus(id, fields.status, user, updatePayload);

    // Send notification based on status change
    if (result && result.assignedToId) {
      const assignedAgent = await serviceRequestService.getUserById(result.assignedToId);
      if (assignedAgent && assignedAgent.pushNotificationToken) {
        if (fields.status === 'COMPLETED') {
          await notificationService.sendSinglePushNotification({
            pushToken: assignedAgent.pushNotificationToken,
            title: 'Service Request Completed',
            message: `Service request #${id} has been completed.`,
            data: { serviceRequestId: id, type: 'COMPLETED', screen: `/service-requests/${id}` },
          });
        } else if (fields.status === 'CANCELLED') {
          await notificationService.sendSinglePushNotification({
            pushToken: assignedAgent.pushNotificationToken,
            title: 'Service Request Cancelled',
            message: `Service request #${id} has been cancelled.`,
            data: { serviceRequestId: id, type: 'CANCELLED', screen: `/service-requests/${id}` },
          });
        }
      }
    }

    reply.code(200).send({
      success: true,
      data: result,
    });
  } catch (error: any) {

    console.log('error is ',error)
    reply.code(error.statusCode || 500).send({
      success: false,
      message: error.message,
    });

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

    // Notify the newly assigned agent
    if (sr && sr.assignedToId) {
      const assignedAgent = await serviceRequestService.getUserById(sr.assignedToId);
      if (assignedAgent && assignedAgent.pushNotificationToken) {
        await notificationService.sendSinglePushNotification({
          pushToken: assignedAgent.pushNotificationToken,
          title: 'New Service Request Assigned',
          message: `Service request #${id} has been assigned to you.`,
          data: { serviceRequestId: id, type: 'NEW_ASSIGNMENT', screen: `/service-requests/${id}` },
        });
      }
    }

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

    // Notify the assigned agent about the schedule
    if (sr && sr.assignedToId) {
      const assignedAgent = await serviceRequestService.getUserById(sr.assignedToId);
      if (assignedAgent && assignedAgent.pushNotificationToken) {
        await notificationService.sendSinglePushNotification({
          pushToken: assignedAgent.pushNotificationToken,
          title: 'Service Request Scheduled',
          message: `Service request #${id} has been scheduled for ${scheduledDate}.`,
          data: { serviceRequestId: id, type: 'SCHEDULED', screen: `/service-requests/${id}` },
        });
      }
    }

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

    if (serviceRequest.type !== ServiceRequestType.INSTALLATION || !serviceRequest.installationRequestId) {
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

    if (serviceRequest.type !== ServiceRequestType.INSTALLATION || !serviceRequest.installationRequestId) {
      throw forbidden('This endpoint is only for installation service requests');
    }

    if (serviceRequest.status !== 'PAYMENT_PENDING') {
      throw badRequest('Service request must be in PAYMENT_PENDING status to refresh payment');
    }

    // Check if user has permission
    if (request.user.role === UserRole.SERVICE_AGENT && serviceRequest.assignedToId !== request.user.userId) {
      throw forbidden('You can only check payment status for your assigned requests');
    }

    const result = await serviceRequestService.refreshPaymentStatus(
      request.params.id,
      request.user
    );

    // If payment is completed, update service request status
    if (result.paymentStatus === 'COMPLETED') {
      await serviceRequestService.updateServiceRequestStatus(
        request.params.id,
        'COMPLETED' as any, // Consider using a more specific type or enum for status
        request.user
      );
      // Notify the customer about payment completion
      if (serviceRequest.customerId) {
        const customer = await serviceRequestService.getUserById(serviceRequest.customerId);
        if (customer && customer.pushNotificationToken) {
          await notificationService.sendSinglePushNotification({
            pushToken: customer.pushNotificationToken,
            title: 'Payment Completed',
            message: `Your payment for service request #${request.params.id} has been completed.`,
            data: { serviceRequestId: request.params.id, type: 'PAYMENT_COMPLETED', screen: `/service-requests/${request.params.id}` },
          });
        }
      }
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
      'COMPLETED' as any, // Consider using a more specific type or enum for status
      request.user
    );

    // Notify the customer about payment completion
    if (serviceRequest.customerId) {
      const customer = await serviceRequestService.getUserById(serviceRequest.customerId);
      if (customer && customer.pushNotificationToken) {
        await notificationService.sendSinglePushNotification({
          pushToken: customer.pushNotificationToken,
          title: 'Payment Verified',
          message: `Your payment for service request #${request.params.id} has been verified and the request is completed.`,
          data: { serviceRequestId: request.params.id, type: 'PAYMENT_VERIFIED_COMPLETED', screen: `/service-requests/${request.params.id}` },
        });
      }
    }

    return reply.code(200).send(result);
  } catch (error) {
    handleError(error, request, reply);
  }
}

// Get all unassigned service requests
export async function getUnassignedServiceRequests(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = request.user as any;
    const result = await serviceRequestService.getAllUnassignedServiceRequests(user);

    reply.code(200).send({
      success: true,
      data: result,
    });
  } catch (error: any) {
    reply.code(error.statusCode || 500).send({
      success: false,
      message: error.message,
    });
  }
}

// Assign service request to self
export async function assignToMe(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const user = request.user as any;

    const result = await serviceRequestService.assignServiceRequestToSelf(id, user);

    // Notify the assigned agent
    if (result && result.assignedToId) {
      const assignedAgent = await serviceRequestService.getUserById(result.assignedToId);
      if (assignedAgent && assignedAgent.pushNotificationToken) {
        await notificationService.sendSinglePushNotification({
          pushToken: assignedAgent.pushNotificationToken,
          title: 'New Service Request Assigned',
          message: `Service request #${id} has been assigned to you.`,
          data: { serviceRequestId: id, type: 'NEW_ASSIGNMENT', screen: `/service-requests/${id}` },
        });
      }
    }

    reply.code(200).send({
      success: true,
      data: result,
      message: 'Service request assigned to you successfully',
    });
  } catch (error: any) {
    reply.code(error.statusCode || 500).send({
      success: false,
      message: error.message,
    });
  }
}