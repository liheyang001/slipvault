import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { initDatabase, getSetting, setSetting, getAllInvoices } from './src/services/database';
import { runDataMigrations } from './src/services/migrations';
import { tryStartup, logSwallowed } from './src/utils/log';
import { initNotifications, cancelScheduledNotification, scheduleMonthlyReminder } from './src/services/notifications';
import { configureAuth, getStoredUser } from './src/services/auth';
import {
  configurePurchases,
  linkPurchasesToUser,
  syncPendingPurchases,
} from './src/services/purchases';
import { RootStackParamList } from './src/types/navigation';
import HomeScreen from './src/screens/HomeScreen';
import CameraScreen from './src/screens/CameraScreen';
import ReviewScreen from './src/screens/ReviewScreen';
import ManualEntryScreen from './src/screens/ManualEntryScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import InvoiceDetailScreen from './src/screens/InvoiceDetailScreen';
import SearchScreen from './src/screens/SearchScreen';
import PaywallScreen from './src/screens/PaywallScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

// Run before any component renders so DB tables exist when screens query them.
// Each step fails open — a broken subsystem must not stop the app opening —
// but each now says so in the log rather than vanishing.
tryStartup('database init', initDatabase);
// After the schema is in place: repairs to existing rows, each guarded by its
// own completion flag.
tryStartup('data migrations', runDataMigrations);
tryStartup('notifications init', initNotifications);
tryStartup('auth config', configureAuth);
tryStartup('purchases config', configurePurchases);
// Link an already-signed-in user to RevenueCat. Without this, anyone who
// signed in on a previous version buys under an anonymous ID and the server
// refuses to credit it — signInWithGoogle only links at the moment of signing
// in, which never runs again for them.
tryStartup('purchase identity link', () => {
  const storedUser = getStoredUser();
  if (storedUser) {
    // Link first, then sync: a purchase recovered before the identity is set
    // would be filed under an anonymous id the server refuses to credit.
    linkPurchasesToUser(storedUser.id)
      .then(() => syncPendingPurchases())
      .catch((err) => logSwallowed('purchase sync', err));
  }
});

// Decided once, before mount — changing Stack.Navigator's initialRouteName after
// mount has no effect, so this must not be a hook/state value. Guarded like the
// steps above: if the settings table isn't ready, fail open to Home rather than
// crashing module evaluation.
let initialRouteName: 'Home' | 'Onboarding' = 'Home';
tryStartup('onboarding check', () => {
  initialRouteName = getSetting('hasSeenOnboarding', 'false') === 'true' ? 'Home' : 'Onboarding';
});

export default function App() {
  useEffect(() => {
    refreshMonthlyNotification().catch((err) => logSwallowed('monthly reminder refresh', err));
  }, []);

  async function refreshMonthlyNotification() {
    if (getSetting('monthlyNotif', 'false') !== 'true') return;

    const oldId = getSetting('monthlyNotifId', '');
    if (oldId) {
      await cancelScheduledNotification(oldId).catch((err) =>
        logSwallowed('cancel stale monthly reminder', err)
      );
      setSetting('monthlyNotifId', '');
    }

    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const invoices = getAllInvoices();
    const monthInvoices = invoices.filter((inv) => inv.date?.startsWith(thisMonth));
    const total = monthInvoices.reduce((s, inv) => s + inv.total, 0);

    const id = await scheduleMonthlyReminder(monthInvoices.length, total).catch(() => null);
    if (id) setSetting('monthlyNotifId', id);
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <NavigationContainer>
      <StatusBar style="auto" />
      <Stack.Navigator
        initialRouteName={initialRouteName}
        screenOptions={{
          headerStyle: { backgroundColor: '#fff' },
          headerTintColor: '#111827',
          headerTitleStyle: { fontWeight: '700' },
        }}
      >
        <Stack.Screen
          name="Onboarding"
          component={OnboardingScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Camera"
          component={CameraScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Review"
          component={ReviewScreen}
          options={{ title: 'Review Invoice' }}
        />
        <Stack.Screen
          name="ManualEntry"
          component={ManualEntryScreen}
          options={{ title: 'Add Item' }}
        />
        <Stack.Screen
          name="InvoiceDetail"
          component={InvoiceDetailScreen}
          options={{ title: 'Item Detail' }}
        />
        <Stack.Screen
          name="Search"
          component={SearchScreen}
          options={{ title: 'Filter Invoices' }}
        />
        <Stack.Screen
          name="Paywall"
          component={PaywallScreen}
          options={{ title: '', presentation: 'modal', headerShown: false }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: 'Settings' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
    </GestureHandlerRootView>
  );
}
