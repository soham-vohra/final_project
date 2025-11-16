import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { Slot, useRouter, useSegments } from 'expo-router';
import 'react-native-reanimated';
import React, { useEffect } from 'react';
import { View, ActivityIndicator, Text } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';

// We won't use unstable_settings.anchor – AuthGate will decide.
export const unstable_settings = {};

function AuthGate() {
  const segments = useSegments();
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;

    // segments is like ['(tabs)', 'index'] or ['(auth)', 'login']
    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      // Not logged in and not already in auth -> go to login
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      // Logged in but still on auth screens -> go to tabs home
      router.replace('/(tabs)');
    }
  }, [segments, isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'black',
        }}
      >
        <ActivityIndicator />
        <Text style={{ color: 'white', marginTop: 8 }}>Loading auth...</Text>
      </View>
    );
  }

  // Slot renders whatever route we're on (tabs, auth, etc),
  // and AuthGate will redirect if it's the wrong place.
  return <Slot />;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AuthGate />
        <StatusBar style="auto" />
      </ThemeProvider>
    </AuthProvider>
  );
}