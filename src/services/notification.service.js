import admin from '../config/firebase.js';
import prisma from '../config/prisma.js';

export async function sendToUser(userId, { title, body, data = {} }) {
  if (!admin.apps.length) return null; // Firebase not initialized

  const userTokens = await prisma.userToken.findMany({
    where: { userId: BigInt(userId), fcmToken: { not: null } },
    select: { id: true, fcmToken: true },
  });

  if (!userTokens.length) return null;

  const tokens = userTokens.map((ut) => ut.fcmToken);

  // eslint-disable-next-line no-useless-catch
  try {
    const result = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data,
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

    return result;
  } catch (err) {
    throw err;
  }
}

export async function sendToMultiple(userIds, payload) {
  if (!admin.apps.length) return null; // Firebase not initialized

  const userTokens = await prisma.userToken.findMany({
    where: { userId: { in: userIds.map((id) => BigInt(id)) }, fcmToken: { not: null } },
    select: { fcmToken: true },
  });

  const tokens = userTokens.map((u) => u.fcmToken);
  if (!tokens.length) return null;

  return admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title: payload.title, body: payload.body },
    data: payload.data ?? {},
  });
}
