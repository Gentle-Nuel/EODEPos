import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../lib/AuthContext';
import SplashScreen from '../screens/SplashScreen';
import LoginScreen from '../screens/LoginScreen';
import AttendantTabs from './AttendantTabs';
import AdminTabs from './AdminTabs';
import ReceiptScreen from '../screens/attendant/ReceiptScreen';
import ManageAttendantsScreen from '../screens/admin/ManageAttendantsScreen';
import StoreDetailsScreen from '../screens/admin/StoreDetailsScreen';
import AdminAccountScreen from '../screens/admin/AdminAccountScreen';
import AdminSalesScreen from '../screens/admin/AdminSalesScreen';
import ExportDataScreen from '../screens/admin/ExportDataScreen';
import NotificationsScreen from '../screens/admin/NotificationsScreen';

const Stack = createNativeStackNavigator();

const SPLASH_MIN_MS = 2500;

export default function RootNavigator() {
  const { user, role, loading } = useAuth();
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), SPLASH_MIN_MS);
    return () => clearTimeout(t);
  }, []);

  const isReady = splashDone && !loading;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
        {!isReady ? (
          <Stack.Screen name="Splash" component={SplashScreen} />
        ) : !user ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : role === 'admin' ? (
          <>
            <Stack.Screen name="AdminTabs" component={AdminTabs} />
            <Stack.Screen
              name="Receipt"
              component={ReceiptScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="ManageAttendants"
              component={ManageAttendantsScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="StoreDetails"
              component={StoreDetailsScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="AdminAccount"
              component={AdminAccountScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="AdminSales"
              component={AdminSalesScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="ExportData"
              component={ExportDataScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="Notifications"
              component={NotificationsScreen}
              options={{ animation: 'slide_from_right' }}
            />
          </>
        ) : (
          <>
            <Stack.Screen name="AttendantTabs" component={AttendantTabs} />
            <Stack.Screen
              name="Receipt"
              component={ReceiptScreen}
              options={{ animation: 'slide_from_right' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
