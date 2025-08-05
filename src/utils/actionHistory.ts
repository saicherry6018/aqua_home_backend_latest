import { actionHistory } from '../models/schema';
import { ActionType, UserRole } from '../types';
import { generateId } from './helpers';
import { getFastifyInstance } from '../shared/fastify-instance';

interface ActionHistoryData {
  // Entity references (one of these should be provided)
  installationRequestId?: string;
  subscriptionId?: string;
  serviceRequestId?: string;
  paymentId?: string;
  
  // Action details
  actionType: ActionType;
  fromStatus?: string;
  toStatus?: string;
  
  // Actor information
  performedBy: string;
  performedByRole: UserRole;
  
  // Additional context
  comment?: string;
  metadata?: Record<string, any>;
}

/**
 * Log an action in the action history table
 */
export async function logActionHistory(data: ActionHistoryData): Promise<void> {
  try {
    const fastify = getFastifyInstance();
    const id = await generateId('ah');

    console.log('actionhistory data ',data)
    
    await fastify.db.insert(actionHistory).values({
      id,
      installationRequestId: data.installationRequestId || null,
      subscriptionId: data.subscriptionId || null,
      serviceRequestId: data.serviceRequestId || null,
      paymentId: data.paymentId || null,
      actionType: data.actionType,
      fromStatus: data.fromStatus || null,
      toStatus: data.toStatus || null,
      performedBy: data.performedBy,
      performedByRole: data.performedByRole,
      comment: data.comment || null,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      createdAt: new Date().toISOString(),
    });
    
    console.log(`Action logged: ${data.actionType} by ${data.performedByRole} (${data.performedBy})`);
  } catch (error) {
    console.error('Failed to log action history:', error);
    // Don't throw error - action history logging should not break the main flow
  }
}

/**
 * Get action history for a specific entity
 */
export async function getActionHistory(entityType: 'installation' | 'subscription' | 'service' | 'payment', entityId: string) {
  const fastify = getFastifyInstance();
  
  let whereCondition;
  switch (entityType) {
    case 'installation':
      whereCondition = { installationRequestId: entityId };
      break;
    case 'subscription':
      whereCondition = { subscriptionId: entityId };
      break;
    case 'service':
      whereCondition = { serviceRequestId: entityId };
      break;
    case 'payment':
      whereCondition = { paymentId: entityId };
      break;
    default:
      throw new Error('Invalid entity type');
  }
  
  const results = await fastify.db.query.actionHistory.findMany({
    where: whereCondition,
    with: {
      performedByUser: {
        columns: {
          id: true,
          name: true,
          phone: true,
          role: true,
        }
      }
    },
    orderBy: (actionHistory, { desc }) => [desc(actionHistory.createdAt)],
  });
  
  return results.map(action => ({
    ...action,
    metadata: action.metadata ? JSON.parse(action.metadata) : null
  }));
}

/**
 * Helper function to create action history entries for service request status changes
 */
export function createServiceRequestStatusAction(
  serviceRequestId: string,
  fromStatus: string | undefined,
  toStatus: string,
  performedBy: string,
  performedByRole: UserRole,
  additionalInfo?: Record<string, any>
): ActionHistoryData {
  const actionType = getActionTypeForServiceRequestStatus(toStatus);
  
  return {
    serviceRequestId,
    actionType,
    fromStatus,
    toStatus,
    performedBy,
    performedByRole,
    comment: `Service request status changed from ${fromStatus || 'none'} to ${toStatus}`,
    metadata: additionalInfo
  };
}

/**
 * Map service request status to appropriate action type
 */
function getActionTypeForServiceRequestStatus(status: string): ActionType {
  switch (status) {
    case 'created':
      return ActionType.SERVICE_REQUEST_CREATED;
    case 'assigned':
      return ActionType.SERVICE_REQUEST_ASSIGNED;
    case 'scheduled':
      return ActionType.SERVICE_REQUEST_SCHEDULED;
    case 'in_progress':
      return ActionType.SERVICE_REQUEST_IN_PROGRESS;
    case 'completed':
      return ActionType.SERVICE_REQUEST_COMPLETED;
    case 'cancelled':
      return ActionType.SERVICE_REQUEST_CANCELLED;
    default:
      return ActionType.SERVICE_REQUEST_CREATED;
  }
}

/**
 * Helper function to create action history entries for installation request status changes
 */
export function createInstallationRequestStatusAction(
  installationRequestId: string,
  fromStatus: string | undefined,
  toStatus: string,
  performedBy: string,
  performedByRole: UserRole,
  additionalInfo?: Record<string, any>
): ActionHistoryData {
  const actionType = getActionTypeForInstallationStatus(toStatus);
  
  return {
    installationRequestId,
    actionType,
    fromStatus,
    toStatus,
    performedBy,
    performedByRole,
    comment: `Installation request status changed from ${fromStatus || 'none'} to ${toStatus}`,
    metadata: additionalInfo
  };
}

/**
 * Map installation request status to appropriate action type
 */
function getActionTypeForInstallationStatus(status: string): ActionType {
  switch (status) {
    case 'SUBMITTED':
      return ActionType.INSTALLATION_REQUEST_SUBMITTED;
    case 'FRANCHISE_CONTACTED':
      return ActionType.INSTALLATION_REQUEST_CONTACTED;
    case 'INSTALLATION_SCHEDULED':
      return ActionType.INSTALLATION_REQUEST_SCHEDULED;
    case 'INSTALLATION_IN_PROGRESS':
      return ActionType.INSTALLATION_REQUEST_IN_PROGRESS;
    case 'INSTALLATION_COMPLETED':
      return ActionType.INSTALLATION_REQUEST_COMPLETED;
    case 'CANCELLED':
      return ActionType.INSTALLATION_REQUEST_CANCELLED;
    case 'REJECTED':
      return ActionType.INSTALLATION_REQUEST_REJECTED;
    default:
      return ActionType.INSTALLATION_REQUEST_SUBMITTED;
  }
}