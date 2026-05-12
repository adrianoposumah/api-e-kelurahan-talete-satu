import admin from '../config/firebase.js';
import prisma from '../config/prisma.js';

const VALID_NOTIFICATION_TYPES = new Set(['submission', 'announcement', 'other']);

const toPushData = (data = {}) =>
  Object.entries(data || {}).reduce((acc, [key, value]) => {
    acc[key] = value === null || value === undefined ? '' : String(value);
    return acc;
  }, {});

const parseBigIntId = (value, fieldName) => {
  try {
    return BigInt(value);
  } catch {
    const error = new Error(`${fieldName} harus berupa angka yang valid`);
    error.code = 'BAD_REQUEST';
    throw error;
  }
};

const parseNotificationType = (type = 'other') => {
  if (VALID_NOTIFICATION_TYPES.has(type)) {
    return type;
  }

  const error = new Error('type notifikasi harus berupa submission, announcement, atau other');
  error.code = 'BAD_REQUEST';
  throw error;
};

export async function createNotification(userId, { title, body, data = {}, type = 'other' }) {
  return prisma.notification.create({
    data: {
      userId: BigInt(userId),
      type: parseNotificationType(type),
      title,
      body,
      data,
    },
  });
}

export async function createNotifications(userIds, { title, body, data = {}, type = 'other' }) {
  const uniqueUserIds = [...new Set(userIds.map((id) => id.toString()))];
  if (!uniqueUserIds.length) return { count: 0 };

  const notificationType = parseNotificationType(type);

  return prisma.notification.createMany({
    data: uniqueUserIds.map((userId) => ({
      userId: BigInt(userId),
      type: notificationType,
      title,
      body,
      data,
    })),
  });
}

export async function getUserNotifications({ userId, page = 1, limit = 20, unreadOnly = false, type }) {
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const skip = (parsedPage - 1) * parsedLimit;

  const where = {
    userId: BigInt(userId),
    ...(unreadOnly ? { readAt: null } : {}),
    ...(type ? { type: parseNotificationType(type) } : {}),
  };

  const [notifications, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      skip,
      take: parsedLimit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({
      where: {
        userId: BigInt(userId),
        readAt: null,
      },
    }),
  ]);

  return {
    notifications,
    unread,
    pagination: {
      page: parsedPage,
      limit: parsedLimit,
      total,
      total_pages: Math.ceil(total / parsedLimit),
    },
  };
}

export async function markNotificationAsRead({ notificationId, userId }) {
  const id = parseBigIntId(notificationId, 'notification_id');
  const parsedUserId = parseBigIntId(userId, 'user_id');

  const notification = await prisma.notification.findFirst({
    where: {
      id,
      userId: parsedUserId,
    },
  });

  if (!notification) {
    const error = new Error('Notifikasi tidak ditemukan');
    error.code = 'NOT_FOUND';
    throw error;
  }

  if (notification.readAt) {
    return notification;
  }

  return prisma.notification.update({
    where: { id },
    data: { readAt: new Date() },
  });
}

export async function sendToUser(userId, { title, body, data = {}, type = 'other' }) {
  const notification = await createNotification(userId, { title, body, data, type });

  if (!admin.apps.length) {
    return { notification, pushResult: null }; // Firebase not initialized
  }

  const userTokens = await prisma.userToken.findMany({
    where: { userId: BigInt(userId), fcmToken: { not: null } },
    select: { id: true, fcmToken: true },
  });

  if (!userTokens.length) return { notification, pushResult: null };

  const tokens = userTokens.map((ut) => ut.fcmToken);

  // eslint-disable-next-line no-useless-catch
  try {
    const result = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: toPushData(data),
      android: { priority: 'high' },
    });

    // Cleanup invalid tokens
    if (result.failureCount > 0) {
      const failedTokens = [];
      result.responses.forEach((resp, idx) => {
        if (!resp.success && (resp.error.code === 'messaging/invalid-registration-token' || resp.error.code === 'messaging/registration-token-not-registered')) {
          failedTokens.push(tokens[idx]);
        }
      });

      if (failedTokens.length > 0) {
        await prisma.userToken.updateMany({
          where: { fcmToken: { in: failedTokens } },
          data: { fcmToken: null },
        });
      }
    }

    return { notification, pushResult: result };
  } catch (err) {
    throw err;
  }
}

export async function sendToMultiple(userIds, payload) {
  const notificationResult = await createNotifications(userIds, payload);

  if (!admin.apps.length) {
    return { notificationResult, pushResult: null }; // Firebase not initialized
  }

  const userTokens = await prisma.userToken.findMany({
    where: { userId: { in: userIds.map((id) => BigInt(id)) }, fcmToken: { not: null } },
    select: { fcmToken: true },
  });

  const tokens = userTokens.map((u) => u.fcmToken);
  if (!tokens.length) return { notificationResult, pushResult: null };

  const result = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title: payload.title, body: payload.body },
    data: toPushData(payload.data ?? {}),
  });

  return { notificationResult, pushResult: result };
}
