import { Injectable, Logger } from "@nestjs/common";
import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getMessaging, type BatchResponse, type MulticastMessage } from "firebase-admin/messaging";

import { PrismaService } from "../../prisma.service";

export type PushMessage = {
  notificationId?: string;
  notificationType: string;
  title: string;
  body: string;
  data?: Record<string, string>;
};

export type PushDeliveryResult = {
  configured: boolean;
  deviceCount: number;
  successCount: number;
  failureCount: number;
  invalidTokenCount: number;
};

@Injectable()
export class FirebaseMessagingService {
  private readonly logger = new Logger(FirebaseMessagingService.name);
  private app?: App;

  constructor(private readonly prisma: PrismaService) {}

  isConfigured() {
    return Boolean(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
        (process.env.FIREBASE_PROJECT_ID &&
          process.env.FIREBASE_CLIENT_EMAIL &&
          process.env.FIREBASE_PRIVATE_KEY),
    );
  }

  async sendToUser(userId: string, message: PushMessage) {
    return this.sendToUsers([userId], message);
  }

  async sendToUsers(
    userIds: string[],
    message: PushMessage,
    options: { throwOnTransientFailure?: boolean } = {},
  ): Promise<PushDeliveryResult> {
    const uniqueUserIds = [...new Set(userIds)];
    if (!this.isConfigured() || !uniqueUserIds.length) {
      return {
        configured: this.isConfigured(),
        deviceCount: 0,
        successCount: 0,
        failureCount: 0,
        invalidTokenCount: 0,
      };
    }

    const devices = await this.prisma.pushDevice.findMany({
      where: { userId: { in: uniqueUserIds }, active: true },
      select: { id: true, token: true },
    });
    if (!devices.length) {
      return {
        configured: true,
        deviceCount: 0,
        successCount: 0,
        failureCount: 0,
        invalidTokenCount: 0,
      };
    }

    const messaging = getMessaging(this.firebaseApp());
    const result: PushDeliveryResult = {
      configured: true,
      deviceCount: devices.length,
      successCount: 0,
      failureCount: 0,
      invalidTokenCount: 0,
    };
    const transientErrors: string[] = [];
    const data: Record<string, string> = {
      notificationId: message.notificationId ?? "",
      notificationType: message.notificationType,
      openNotifications: "true",
      ...(message.data ?? {}),
    };

    for (let offset = 0; offset < devices.length; offset += 500) {
      const batch = devices.slice(offset, offset + 500);
      const payload: MulticastMessage = {
        tokens: batch.map((device) => device.token),
        notification: { title: message.title, body: message.body },
        android: {
          priority: "high",
          notification: {
            channelId: "smarts_notifications_v2",
            icon: "ic_notification_small",
            sound: "default",
          },
        },
        data,
      };
      const response = await messaging.sendEachForMulticast(payload);
      this.mergeBatchResult(response, result, transientErrors, batch);
    }

    if (transientErrors.length && options.throwOnTransientFailure !== false) {
      throw new Error(
        `FCM delivery failed for ${transientErrors.length} device(s): ${transientErrors.slice(0, 3).join("; ")}`,
      );
    }
    return result;
  }

  async registerDevice(
    userId: string,
    input: { token: string; platform: string; appVersion?: string },
  ) {
    const token = input.token.trim();
    const platform = input.platform.trim().toLowerCase();
    const device = await this.prisma.pushDevice.upsert({
      where: { token },
      create: {
        userId,
        token,
        platform,
        appVersion: input.appVersion?.trim() || null,
        active: true,
        lastSeenAt: new Date(),
      },
      update: {
        userId,
        platform,
        appVersion: input.appVersion?.trim() || null,
        active: true,
        lastSeenAt: new Date(),
      },
      select: { id: true, platform: true, active: true, lastSeenAt: true },
    });
    return device;
  }

  async unregisterDevice(userId: string, token: string) {
    const updated = await this.prisma.pushDevice.updateMany({
      where: { userId, token: token.trim() },
      data: { active: false, lastSeenAt: new Date() },
    });
    return { removed: updated.count > 0 };
  }

  async status() {
    const [activeDevices, configured] = await Promise.all([
      this.prisma.pushDevice.count({ where: { active: true } }),
      Promise.resolve(this.isConfigured()),
    ]);
    return { configured, activeDevices };
  }

  private firebaseApp() {
    if (this.app) return this.app;
    const existing = getApps()[0];
    if (existing) {
      this.app = existing;
      return existing;
    }
    const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (json) {
      const serviceAccount = JSON.parse(json) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };
      this.app = initializeApp({ credential: cert(serviceAccount as never) });
      return this.app;
    }
    this.app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
    return this.app;
  }

  private mergeBatchResult(
    response: BatchResponse,
    result: PushDeliveryResult,
    transientErrors: string[],
    devices: Array<{ id: string; token: string }>,
  ) {
    result.successCount += response.successCount;
    result.failureCount += response.failureCount;
    const invalidDeviceIds: string[] = [];
    response.responses.forEach((item, index) => {
      if (item.success || !item.error) return;
      const code = item.error.code ?? "";
      if (
        code.includes("registration-token-not-registered") ||
        code.includes("invalid-registration-token")
      ) {
        invalidDeviceIds.push(devices[index].id);
        result.invalidTokenCount += 1;
      } else {
        transientErrors.push(item.error.message);
      }
    });
    if (invalidDeviceIds.length) {
      void this.prisma.pushDevice.updateMany({
        where: { id: { in: invalidDeviceIds } },
        data: { active: false },
      }).catch((error) => {
        this.logger.warn(`Could not deactivate invalid FCM tokens: ${String(error)}`);
      });
    }
  }
}
