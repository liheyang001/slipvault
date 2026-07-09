import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { initDatabase, getSetting, setSetting, getAllInvoices } from './src/services/database';
import { initNotifications, cancelScheduledNotification, scheduleMonthlyReminder } from './src/services/notifications';
import { RootStackParamList } from './src/types/navigation';
import HomeScreen from './src/screens/HomeScreen';
import CameraScreen from './src/screens/CameraScreen';
import ReviewScreen from './src/screens/ReviewScreen';
import InvoiceDetailScreen from './src/screens/InvoiceDetailScreen';
import SearchScreen from './src/screens/SearchScreen';
import RoomsScreen from './src/screens/RoomsScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

// Run before any component renders so DB tables exist when screens query them
try { initDatabase(); } catch {}
try { initNotifications(); } catch {}

export default function App() {
  useEffect(() => {
    refreshMonthlyNotification().catch(() => {});
  }, []);

  async function refreshMonthlyNotification() {
    if (getSetting('monthlyNotif', 'false') !== 'true') return;

    const oldId = getSetting('monthlyNotifId', '');
    if (oldId) {
      await cancelScheduledNotification(oldId).catch(() => {});
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
        initialRouteName="Home"
        screenOptions={{
          headerStyle: { backgroundColor: '#fff' },
          headerTintColor: '#111827',
          headerTitleStyle: { fontWeight: '700' },
        }}
      >
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: 'Slipvault' }}
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
          name="InvoiceDetail"
          component={InvoiceDetailScreen}
          options={{ title: 'Invoice Detail' }}
        />
        <Stack.Screen
          name="Search"
          component={SearchScreen}
          options={{ title: 'Filter Invoices' }}
        />
        <Stack.Screen
          name="Rooms"
          component={RoomsScreen}
          options={{ title: 'Rooms' }}
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
