import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

// Adjust this path if your mockData file lives somewhere else,
// but from app/(tabs)/index.tsx, ../../mockData is the usual root-level location.
import { mockMovies } from '../mockData';

export default function HomeScreen() {
  return (
    <ThemedView style={styles.screen}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.title}>
          Movie Gallery
        </ThemedText>
        <ThemedText type="default" style={styles.subtitle}>
          Showing Movies from mock data
        </ThemedText>
      </View>

      {/* Horizontal movie scroller, flush to the top section */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollerContent}
        style={styles.scroller}
      >
        {mockMovies.map((movie) => (
          <View key={movie.id} style={styles.card}>
            <View style={styles.posterWrapper}>
              <Image
                source={{ uri: movie.poster_url }}
                style={styles.poster}
                contentFit="cover"
              />
            </View>

            <View style={styles.cardBody}>
              <View style={styles.cardTitleRow}>
                <ThemedText
                  numberOfLines={1}
                  type="default"
                  style={styles.cardYear}
                >
                  {movie.title}
                </ThemedText>
                <ThemedText type="default" style={styles.cardYear}>
                  {movie.release_year}
                </ThemedText>
              </View>

              <View style={styles.cardMetaRow}>
                <View style={styles.badge}>
                  <ThemedText type="defaultSemiBold" style={styles.cardYear}>
                    {movie.content_rating ?? 'NR'}
                  </ThemedText>
                </View>

                <ThemedText type="default" style={styles.runtime}>
                  {movie.runtime_minutes ? `${movie.runtime_minutes} min` : '—'}
                </ThemedText>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: '#05010B',
    marginTop: '15%',
  },
  header: {
    paddingHorizontal: 16,
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 20,
    letterSpacing: -0.03,
    color: '#FFFFFF',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 12,
    color: 'rgba(228, 206, 255, 0.85)',
  },
  scroller: {
    flexGrow: 0,
  },
  scrollerContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  card: {
    width: 180,
    borderRadius: 18,
    overflow: 'hidden',
    marginRight: 16,
    backgroundColor: 'rgba(17, 4, 33, 0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 120, 255, 0.35)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.55,
    shadowRadius: 22,
    elevation: 10,
  },
  posterWrapper: {
    width: '100%',
    aspectRatio: 2 / 3,
    overflow: 'hidden',
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  cardBody: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardTitle: {
    flex: 1,
    marginRight: 6,
    fontSize: 13,
    color: '#FFFFFF',
  },
  cardYear: {
    fontSize: 11,
    color: 'rgba(234, 223, 255, 0.8)',
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.7)',
    backgroundColor: 'rgba(52, 9, 74, 0.95)',
  },
  badgeText: {
    fontSize: 10,
  },
  runtime: {
    fontSize: 11,
    color: 'rgba(232, 216, 255, 0.9)',
  },
  idText: {
    fontSize: 10,
    color: 'rgba(195, 176, 233, 0.7)',
  },
});
