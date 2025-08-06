
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';

export class NotificationService {
  private expo: Expo;

  constructor() {
    this.expo = new Expo();
  }

  async sendPushNotification(data: {
    title: string;
    message: string;
    registrationTokens: string[];
    data?: Record<string, any>;
  }) {
    const validTokens = data.registrationTokens.filter(token => 
      Expo.isExpoPushToken(token)
    );

    if (validTokens.length === 0) {
      console.log('No valid Expo push tokens found');
      return { success: false, sentCount: 0 };
    }

    const messages: ExpoPushMessage[] = validTokens.map(token => ({
      to: token,
      title: data.title,
      body: data.message,
      data: data.data || {},
      sound: 'default',
      priority: 'high',
      badge: 1,
    }));

    const chunks = this.expo.chunkPushNotifications(messages);
    const tickets: ExpoPushTicket[] = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('Error sending push notification chunk:', error);
      }
    }

    const successfulTickets = tickets.filter(ticket => ticket.status === 'ok');
    
    console.log(`Push notifications sent: ${successfulTickets.length}/${validTokens.length}`);

    return {
      success: successfulTickets.length > 0,
      tickets,
      sentCount: successfulTickets.length,
      totalTokens: validTokens.length
    };
  }

  async sendSinglePushNotification(data: {
    pushToken: string;
    title: string;
    message: string;
    data?: Record<string, any>;
  }) {
    if (!Expo.isExpoPushToken(data.pushToken)) {
      console.log('Invalid Expo push token:', data.pushToken);
      throw new Error('Invalid Expo push token');
    }

    const message: ExpoPushMessage = {
      to: data.pushToken,
      title: data.title,
      body: data.message,
      data: data.data || {},
      sound: 'default',
      priority: 'high',
      badge: 1,
    };

    const chunks = this.expo.chunkPushNotifications([message]);
    const tickets: ExpoPushTicket[] = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('Error sending push notification:', error);
        throw error;
      }
    }

    const successfulTickets = tickets.filter(ticket => ticket.status === 'ok');

    return {
      success: successfulTickets.length > 0,
      tickets,
      sentCount: successfulTickets.length
    };
  }
}

// Export singleton instance
export const notificationService = new NotificationService();

// Export helper function for backwards compatibility
export async function sendPushNotification(data: {
  title: string;
  message: string;
  registrationTokens: string[];
  data?: Record<string, any>;
}) {
  return notificationService.sendPushNotification(data);
}
