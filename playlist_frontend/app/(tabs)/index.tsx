import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  FlatList,
  StyleSheet,
  View,
  TextInput,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/providers/AuthProvider';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL;
if (!API_BASE_URL) {
  console.warn('EXPO_PUBLIC_API_URL is not defined. Check your .env file.');
}

type HomeSection = {
  id: string;
  title: string;
  style: 'rail' | 'grid';
  movies: any[];
};

export default function HomeScreen() {
  const { user } = useAuth();
  const [sections, setSections] = useState<HomeSection[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHomeFeed = useCallback(
    async (opts?: { refreshing?: boolean }) => {
      if (!user) return;

      const refreshing = opts?.refreshing ?? false;

      try {
        if (refreshing) {
          setIsRefreshing(true);
        } else {
          setIsLoading(true);
        }
        setError(null);

        const params = new URLSearchParams();
        params.append('user_id', user.id);
        params.append('max_candidates', '500');

        const response = await fetch(`${API_BASE_URL}/v1/home?${params.toString()}`);
        if (!response.ok) {
          throw new Error('Failed to load home feed');
        }

        const data = await response.json();
        setSections(data.sections ?? []);
      } catch (err) {
        console.error('Error loading home feed', err);
        setError('Failed to load your personalized feed. Pull to refresh to try again.');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [user]
  );

  useEffect(() => {
    fetchHomeFeed();
  }, [fetchHomeFeed]);

  const handleRefresh = () => {
    if (!user) return;
    fetchHomeFeed({ refreshing: true });
  };

  // Filter sections by search text (client-side) on movie title
  const filteredSections = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sections;

    return sections
      .map((section) => {
        const filteredMovies = (section.movies || []).filter((m: any) => {
          const title = (m.title || '').toLowerCase();
          return title.includes(q);
        });
        return { ...section, movies: filteredMovies };
      })
      .filter((section) => (section.movies || []).length > 0);
  }, [sections, search]);

  const renderRailCard = (movie: any) => {
    const title: string = movie.title || '';
    const releaseDate: string | null = movie.release_date || null;
    const year = releaseDate ? releaseDate.slice(0, 4) : '';
    const posterPath: string | null = movie.poster_path || null;
    const similarity: number | null =
      typeof movie.similarity === 'number' ? movie.similarity : null;

    // similarity is in [-1, 1]; we convert to a loose match %
    const matchPercent =
      similarity !== null ? Math.round(Math.max(0, Math.min(1, similarity)) * 100) : null;

    const posterUrl = posterPath
      ? `https://image.tmdb.org/t/p/w500${posterPath}`
      : 'https://via.placeholder.com/300x450.png?text=No+Image';

    return (
      <Pressable style={styles.railCard}>
        <View style={styles.railPosterWrapper}>
          <Image source={{ uri: posterUrl }} style={styles.railPoster} contentFit="cover" />
        </View>
        <View style={styles.railCardBody}>
          <ThemedText
            numberOfLines={1}
            type="defaultSemiBold"
            style={styles.railCardTitle}
          >
            {title}
          </ThemedText>
          <View style={styles.railMetaRow}>
            {year ? (
              <ThemedText type="default" style={styles.railCardMeta}>
                {year}
              </ThemedText>
            ) : null}
            {matchPercent !== null ? (
              <View style={styles.matchBadge}>
                <ThemedText type="defaultSemiBold" style={styles.matchBadgeText}>
                  {matchPercent}% match
                </ThemedText>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <ThemedView style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <ThemedText type="title" style={styles.title}>
          Your CineSync Home
        </ThemedText>
        <ThemedText type="default" style={styles.subtitle}>
          Personalized movie seleciton based on your vibe.
        </ThemedText>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search within your picks..."
          placeholderTextColor="rgba(228, 206, 255, 0.6)"
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      {/* Content */}
      {isLoading && !isRefreshing ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator />
          <ThemedText type="default" style={styles.loaderText}>
            Pulling your vibe-aligned picks...
          </ThemedText>
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.railsContent}
          showsVerticalScrollIndicator={false}
          refreshControl={undefined}
        >
          {error ? (
            <View style={styles.errorContainer}>
              <ThemedText type="default" style={styles.errorText}>
                {error}
              </ThemedText>
            </View>
          ) : null}

          {filteredSections.length === 0 && !error ? (
            <View style={styles.emptyState}>
              <ThemedText type="default" style={styles.emptyStateText}>
                No recommendations yet. Try running the vibe quiz or check back after we ingest
                more movies.
              </ThemedText>
            </View>
          ) : (
            filteredSections.map((section) => (
              <View key={section.id} style={styles.section}>
                <View style={styles.sectionHeader}>
                  <ThemedText type="title" style={styles.sectionTitle}>
                    {section.title}
                  </ThemedText>
                </View>
                <FlatList
                  data={section.movies}
                  keyExtractor={(movie: any) => String(movie.id)}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.railListContent}
                  renderItem={({ item }) => renderRailCard(item)}
                />
              </View>
            ))
          )}
        </ScrollView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingTop: 72,
    paddingBottom: 16,
    backgroundColor: '#05010B',
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  title: {
    fontSize: 22,
    letterSpacing: -0.03,
    color: '#FFFFFF',
    textAlign: 'left',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 12,
    color: 'rgba(228, 206, 255, 0.85)',
    textAlign: 'left',
  },
  searchContainer: {
    paddingHorizontal: 20,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(24, 9, 44, 0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.7)',
    color: '#FFFFFF',
    fontSize: 13,
  },
  list: {
    flex: 1,
  },
  railsContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 18,
  },
  sectionHeader: {
    paddingHorizontal: 4,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  sectionTitle: {
    fontSize: 16,
    color: '#FFFFFF',
  },
  railListContent: {
    paddingRight: 4,
  },
  railCard: {
    width: 140,
    marginRight: 12,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(17, 4, 33, 0.95)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.4)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 6,
  },
  railPosterWrapper: {
    width: '100%',
    aspectRatio: 2 / 3,
    overflow: 'hidden',
  },
  railPoster: {
    width: '100%',
    height: '100%',
  },
  railCardBody: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 4,
  },
  railCardTitle: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '600',
    marginBottom: 4,
  },
  railMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  railCardMeta: {
    fontSize: 11,
    color: '#F4ECFF',
  },
  matchBadge: {
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(126, 52, 255, 0.9)',
  },
  matchBadgeText: {
    fontSize: 10,
    color: '#FFFFFF',
  },
  loaderContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderText: {
    marginTop: 8,
    fontSize: 12,
    color: 'rgba(228, 206, 255, 0.8)',
  },
  errorContainer: {
    paddingVertical: 12,
  },
  errorText: {
    fontSize: 12,
    color: '#FF8E9E',
  },
  emptyState: {
    paddingTop: 40,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 14,
    color: 'rgba(228, 206, 255, 0.8)',
    textAlign: 'center',
  },
});

export {};
