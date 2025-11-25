// playlist_frontend/components/GlobalLoader.tsx
import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useLoading } from '@/providers/LoadingProvider';

export function GlobalLoader() {
  const { isLoading, message } = useLoading();

  if (!isLoading) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <ActivityIndicator />
        <Text style={styles.text}>
          {message || 'Loading...'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.85)',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      },
    card: {
        backgroundColor: '#111',
        paddingHorizontal: 24,
        paddingVertical: 18,
        borderRadius: 12,
        alignItems: 'center',
      },
    text: {
        color: 'white',
        marginTop: 8,
        fontSize: 14,
      },
});