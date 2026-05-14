import * as Notifications from 'expo-notifications';

export function initNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Schedule a warranty expiry reminder 30 days before the expiry date.
 * Returns the notification identifier, or null if scheduling was skipped
 * (past date or permission denied).
 */
export async function scheduleWarrantyReminder(
  invoiceId: string,
  vendor: string,
  purchaseDate: string,
  warrantyMonths: number
): Promise<string | null> {
  if (!warrantyMonths) return null;

  const expiry = new Date(purchaseDate);
  expiry.setMonth(expiry.getMonth() + warrantyMonths);

  const reminderDate = new Date(expiry);
  reminderDate.setDate(reminderDate.getDate() - 30);

  if (reminderDate <= new Date()) return null;

  const granted = await requestNotificationPermission();
  if (!granted) return null;

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Warranty Expiring Soon',
      body: `Your warranty for ${vendor || 'an item'} expires on ${expiry.toDateString()}.`,
      data: { invoiceId },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: reminderDate,
    },
  });

  return id;
}

export async function cancelWarrantyReminder(notifId: string): Promise<void> {
  if (!notifId) return;
  await Notifications.cancelScheduledNotificationAsync(notifId);
}

export async function cancelScheduledNotification(notifId: string): Promise<void> {
  if (!notifId) return;
  await Notifications.cancelScheduledNotificationAsync(notifId);
}

/**
 * Schedule a monthly summary notification for the 1st of next month.
 * Content reflects the current month's invoice stats passed in.
 */
export async function scheduleMonthlyReminder(
  invoiceCount: number,
  total: number
): Promise<string | null> {
  const granted = await requestNotificationPermission();
  if (!granted) return null;

  const now = new Date();
  const monthName = now.toLocaleString('en-US', { month: 'long' });
  const trigger = new Date(now.getFullYear(), now.getMonth() + 1, 1, 9, 0, 0);

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: `${monthName} Summary`,
      body:
        invoiceCount > 0
          ? `You recorded ${invoiceCount} invoice${invoiceCount !== 1 ? 's' : ''} totaling $${total.toFixed(2)} in ${monthName}.`
          : `No invoices recorded in ${monthName}.`,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: trigger,
    },
  });

  return id;
}
