import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, TextInput } from 'react-native';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

// Adjust this path if your mockData file lives somewhere else.
// From app/(tabs)/index.tsx, ../../mockData points at the project-level mockData.js.
import { mockMovies } from '../mockData';

export default function HomeScreen() {
  const [search, setSearch] = useState('');

  const filteredMovies = useMemo(
    () =>
      mockMovies.filter((movie) =>
        movie.title.toLowerCase().includes(search.trim().toLowerCase())
      ),
    [search]
  );

  return (
    <ThemedView style={styles.screen}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.title}>
          Mock Movie Gallery
        </ThemedText>
        <ThemedText type="default" style={styles.subtitle}>
          Search our CineSync mock movie catalog by title.
        </ThemedText>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search movies by title..."
          placeholderTextColor="rgba(228, 206, 255, 0.6)"
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      {/* Vertical movie list using filtered results */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        style={styles.list}
      >
        <View style={styles.grid}>
          {filteredMovies.map((movie) => (
            <View key={movie.id} style={styles.card}>
              <View style={styles.posterWrapper}>
                <Image
                  source={{ uri: movie.poster_url }}
                  style={styles.poster}
                  contentFit="cover"
                />
              </View>

              <View style={styles.cardBody}>
                <ThemedText
                  numberOfLines={1}
                  type="defaultSemiBold"
                  style={styles.cardTitle}
                >
                  {movie.title}
                </ThemedText>
                <ThemedText type="default" style={styles.cardYear}>
                  {movie.release_year}
                </ThemedText>

                <View style={styles.cardMetaRow}>
                  <View style={styles.badge}>
                    <ThemedText type="defaultSemiBold" style={styles.badgeText}>
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
        </View>
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
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 32,
  },
  searchContainer: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  searchInput: {
    width: '100%',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(24, 9, 44, 0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.7)',
    color: '#FFFFFF',
    fontSize: 13,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 16,
  },
  card: {
    width: '48%',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(17, 4, 33, 0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.4)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  posterWrapper: {
    width: '100%',
    aspectRatio: 1 / 1.3,
    overflow: 'hidden',
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  cardBody: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  cardTitle: {
    fontSize: 12,
    color: '#F9F9F9',
    fontWeight: '600',
    marginBottom: 2,
  },
  cardYear: {
    fontSize: 10,
    color: '#EDE7F6',
    marginBottom: 4,
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  badge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 200, 255, 0.8)',
    backgroundColor: 'rgba(58, 10, 85, 0.95)',
  },
  badgeText: {
    fontSize: 9,
    color: '#FFF8F8',
  },
  runtime: {
    fontSize: 10,
    color: '#F5F3FA',
  },
  idText: {
    fontSize: 10,
    color: 'rgba(195, 176, 233, 0.7)',
  },
});