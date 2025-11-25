import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { Slot, useRouter, useSegments } from 'expo-router';
import 'react-native-reanimated';
import React, { useEffect, useState, createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { LoadingProvider, useLoading } from '@/providers/LoadingProvider';
import { GlobalLoader } from '@/components/GlobalLoader';


// We won't use unstable_settings.anchor – AuthGate will decide.
export const unstable_settings = {};

function AuthGate() {
  const segments = useSegments();
  const router = useRouter();
  const { isAuthenticated, isLoading, user, supabase } = useAuth();
  const { showLoading, hideLoading } = useLoading();
  const [bootLoading, setBootLoading] = useState(true);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [hasPreferences, setHasPreferences] = useState<boolean | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      // If not authenticated, clear onboarding flags and stop.
      if (!isAuthenticated || !user) {
        setHasProfile(null);
        setHasPreferences(null);
        setBootLoading(false);
        hideLoading();
        return;
      }

      showLoading('Checking your account...');
      try {
        // 1) Check if profile exists
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', user.id)
          .maybeSingle();

        if (profileError) {
          console.error('Error loading profile', profileError);
        }
        const hasCompletedProfile =
          !!profile && profile.display_name !== null && profile.display_name !== '';

        setHasProfile(hasCompletedProfile);

        // 2) Check if user_preferences row exists
        const { data: prefs, error: prefsError } = await supabase
          .from('user_preferences')
          .select('user_id')
          .eq('user_id', user.id)
          .maybeSingle();

        if (prefsError) {
          console.error('Error loading user preferences', prefsError);
        }
        setHasPreferences(!!prefs);
      } catch (e) {
        console.error('Error bootstrapping onboarding state', e);
      } finally {
        setBootLoading(false);
        hideLoading();
      }
    };

    // Only run bootstrap once auth loading has finished.
    if (!isLoading) {
      bootstrap();
    }
  }, [isAuthenticated, isLoading, user, supabase]);

  useEffect(() => {
    if (isLoading || bootLoading) return;

    // segments is like ['(tabs)', 'index'] or ['(auth)', 'login'] or ['profile-setup']
    const rootSegment = segments[0];
    const inAuthGroup = rootSegment === '(auth)';
    const inTabsGroup = rootSegment === '(tabs)';
    const onProfileSetup = rootSegment === '(profile-setup)';
    const onVibeQuiz = rootSegment === '(vibe-quiz)';

    // 1) Not authenticated: ensure we're on auth stack
    if (!isAuthenticated) {
      if (!inAuthGroup) {
        router.replace('/(auth)/login');
      }
      return;
    }

    // 2) Authenticated, but still resolving onboarding flags
    if (hasProfile === null || hasPreferences === null) {
      return;
    }

    // 3) Authenticated but no profile yet -> force profile setup,
    //    but allow explicit navigation to the vibe quiz screen and
    //    do not yank the user out of the main tabs group once they're there.
    if (!hasProfile && !onProfileSetup && !onVibeQuiz && !inTabsGroup) {
      router.replace('/profile-setup');
      return;
    }

    // 4) Profile exists but no preferences yet -> force vibe quiz,
    //    but allow the user to be on the main tabs after completing it.
    if (hasProfile && !hasPreferences && !onVibeQuiz && !inTabsGroup) {
      router.replace('/vibe-quiz');
      return;
    }

    // 5) Fully onboarded user: keep them out of auth and onboarding routes
    if (hasProfile && hasPreferences) {
      if (inAuthGroup || onProfileSetup || onVibeQuiz) {
        router.replace('/(tabs)');
        return;
      }
    }
  }, [segments, isAuthenticated, isLoading, bootLoading, hasProfile, hasPreferences, router]);

  if (isLoading || bootLoading) {
    // GlobalLoader will show while we wait for auth/bootstrap
    return null;
  }

  // Slot renders whatever route we're on (tabs, auth, etc),
  // and AuthGate will redirect if it's the wrong place.
  return <Slot />;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider>
      <LoadingProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <AuthGate />
          <GlobalLoader />
          <StatusBar style="auto" />
        </ThemeProvider>
      </LoadingProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  
});