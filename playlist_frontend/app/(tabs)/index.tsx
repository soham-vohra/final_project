import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  FlatList,
  StyleSheet,
  View,
  TextInput,
  Pressable,
  ActivityIndicator,
  Modal,
  Dimensions,
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

  const [globalResults, setGlobalResults] = useState<any[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedMovie, setSelectedMovie] = useState<any | null>(null);

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

  const runGlobalSearch = useCallback(
    async () => {
      if (!user) return;
      const q = search.trim();
      if (!q) {
        setGlobalResults(null);
        setSearchError(null);
        return;
      }
      if (!API_BASE_URL) {
        console.warn('API base URL is not configured; cannot run search.');
        setSearchError('Search is temporarily unavailable.');
        return;
      }

      try {
        setIsSearching(true);
        setSearchError(null);

        const params = new URLSearchParams();
        params.append('q', q);
        if (user.id) {
          params.append('user_id', user.id);
        }

        const res = await fetch(`${API_BASE_URL}/v1/search/movies?${params.toString()}`);
        if (!res.ok) {
          const txt = await res.text();
          console.error('Search request failed', txt);
          throw new Error('Search failed');
        }

        const data = await res.json();
        setGlobalResults(data.results ?? []);
      } catch (err) {
        console.error('Error running global search', err);
        setSearchError('Something went wrong searching the wider catalog. Please try again.');
      } finally {
        setIsSearching(false);
      }
    },
    [user, search]
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
      <Pressable
        style={styles.railCard}
        onPress={() => setSelectedMovie(movie)}
      >
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
          placeholder="Find your favorite movies..."
          placeholderTextColor="rgba(228, 206, 255, 0.6)"
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          onSubmitEditing={runGlobalSearch}
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

          {searchError ? (
            <View style={styles.errorContainer}>
              <ThemedText type="default" style={styles.errorText}>
                {searchError}
              </ThemedText>
            </View>
          ) : null}

          {isSearching && (
            <View style={styles.searchStatusContainer}>
              <ActivityIndicator />
              <ThemedText type="default" style={styles.loaderText}>
                Searching the wider catalog...
              </ThemedText>
            </View>
          )}

          {globalResults && !isSearching && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <ThemedText type="title" style={styles.sectionTitle}>
                  Search results
                </ThemedText>
              </View>
              {globalResults.length === 0 ? (
                <View style={styles.emptyState}>
                  <ThemedText type="default" style={styles.emptyStateText}>
                    No matches found. Try another title.
                  </ThemedText>
                </View>
              ) : (
                <FlatList
                  data={globalResults}
                  keyExtractor={(movie: any) => String(movie.id)}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.railListContent}
                  renderItem={({ item }) => renderRailCard(item)}
                />
              )}
            </View>
          )}

          {filteredSections.length === 0 && !error ? (
            <View style={styles.emptyState}>
              <ThemedText type="default" style={styles.emptyStateText}>
                We couldn't find any local hits. Press search to explore the Movie Universe
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
      {selectedMovie && (
        <MovieDetailsModal
          movie={selectedMovie}
          onClose={() => setSelectedMovie(null)}
        />
      )}
    </ThemedView>
  );
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

function MovieDetailsModal({
  movie,
  onClose,
}: {
  movie: any;
  onClose: () => void;
}) {
  const { user, supabase } = useAuth();

  const [loading, setLoading] = useState(true);
  const [movieRow, setMovieRow] = useState<any | null>(null);
  const [movieVibe, setMovieVibe] = useState<number[] | null>(null);
  const [userPref, setUserPref] = useState<number[] | null>(null);
  const [isInWatchlist, setIsInWatchlist] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addedMessage, setAddedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!movie || !user) return;

    const loadDetails = async () => {
      setLoading(true);
      try {
        const { data: movieData } = await supabase
          .from('movies')
          .select('*')
          .eq('id', movie.id)
          .maybeSingle();

        const { data: vibeData } = await supabase
          .from('movie_vibes')
          .select('vibe_vector')
          .eq('movie_id', movie.id)
          .maybeSingle();

        const { data: prefData } = await supabase
          .from('user_preferences')
          .select('preference_vector')
          .eq('user_id', user.id)
          .maybeSingle();

        const { data: profileData } = await supabase
          .from('profiles')
          .select('watchlist_movie_ids')
          .eq('id', user.id)
          .maybeSingle();

        setMovieRow(movieData || movie);
        setMovieVibe(vibeData?.vibe_vector || null);
        setUserPref(prefData?.preference_vector || null);

        const ids = (profileData?.watchlist_movie_ids || []).map(Number);
        setIsInWatchlist(ids.includes(Number(movie.id)));
      } finally {
        setLoading(false);
      }
    };

    loadDetails();
  }, [movie, user]);

  const addToWatchlist = async () => {
    if (!user || saving) return;
    setSaving(true);
    setAddedMessage(null);

    try {
      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('watchlist_movie_ids')
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        console.error('Error loading profile for watchlist update', error);
        return;
      }

      const current = (profileData?.watchlist_movie_ids || []).map(Number);
      const updated = Array.from(new Set([...current, Number(movie.id)]));

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ watchlist_movie_ids: updated })
        .eq('id', user.id);

      if (updateError) {
        console.error('Error updating watchlist', updateError);
        return;
      }

      setIsInWatchlist(true);
      setAddedMessage('Added to your watchlist');
    } catch (e) {
      console.error('Unexpected error adding to watchlist', e);
    } finally {
      setSaving(false);
    }
  };

  const vibePills = React.useMemo(() => {
    if (!movieVibe) return [];
    const v = movieVibe;
    const pills: string[] = [];

    const add = (val: number, pos: string, neg: string, t = 0.35) => {
      if (val > t) pills.push(pos);
      else if (val < -t) pills.push(neg);
    };

    add(v[0], 'Arthouse', 'Mainstream');
    add(v[1], 'Dark Tone', 'Light Tone');
    add(v[2], 'Slow Burn', 'Fast Paced');
    add(v[6], 'Fantastical', 'Grounded');
    add(v[9], 'Comfort Watch', 'Challenging');

    return pills.slice(0, 4);
  }, [movieVibe]);

  const whyThisText = React.useMemo(() => {
    if (!movieVibe || !userPref) return null;

    const axes = [
      { i: 0, pos: 'artsy films', neg: 'mainstream hits' },
      { i: 1, pos: 'dark tones', neg: 'lighter moods' },
      { i: 2, pos: 'slow-burn pacing', neg: 'fast energy' },
      { i: 6, pos: 'fantastical worlds', neg: 'grounded stories' },
      { i: 9, pos: 'comfort films', neg: 'challenging cinema' },
    ];

    const scores = axes.map(a => ({
      ...a,
      score: (userPref[a.i] || 0) * (movieVibe[a.i] || 0),
    }));

    const top = scores
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
      .slice(0, 2);

    if (!top.length) return null;

    return `Because you tend to enjoy ${top
      .map(t => (t.score > 0 ? t.pos : t.neg))
      .join(' and ')}, this movie aligns strongly with your taste.`;
  }, [movieVibe, userPref]);

  return (
    <Modal transparent animationType="fade" visible>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable
          style={[styles.modalContainer, { maxHeight: SCREEN_HEIGHT * 0.9 }]}
          onPress={(e) => e.stopPropagation()}
        >
          {loading ? (
            <ActivityIndicator />
          ) : (
            <>
              <Pressable style={styles.modalClose} onPress={onClose}>
                <ThemedText style={{ color: '#fff' }}>✕</ThemedText>
              </Pressable>

              <Image
                source={{
                  uri: movie.poster_path
                    ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
                    : undefined,
                }}
                style={styles.modalPoster}
                contentFit="cover"
              />

              <View style={styles.modalTitleRow}>
                <ThemedText style={styles.modalTitle}>{movieRow?.title}</ThemedText>
                {typeof movie.similarity === 'number' && (
                  <View style={styles.matchPillLarge}>
                    <ThemedText style={styles.matchPillLargeText}>
                      {Math.round(Math.max(0, Math.min(1, movie.similarity)) * 100)}% match
                    </ThemedText>
                  </View>
                )}
              </View>

              <ThemedText style={styles.modalOverview} numberOfLines={6}>
                {movieRow?.overview}
              </ThemedText>

              {whyThisText && (
                <ThemedText style={styles.whyThisText}>
                  {whyThisText}
                </ThemedText>
              )}

              <View style={styles.modalVibesRow}>
                {vibePills.map((pill) => (
                  <View key={pill} style={styles.vibePill}>
                    <ThemedText style={styles.vibePillText}>{pill}</ThemedText>
                  </View>
                ))}
              </View>

              <Pressable
                style={[
                  styles.watchlistButton,
                  (isInWatchlist || saving) && { opacity: 0.7 },
                ]}
                disabled={isInWatchlist || saving}
                onPress={addToWatchlist}
              >
                {saving ? (
                  <View style={styles.watchlistButtonContent}>
                    <ActivityIndicator style={styles.watchlistButtonSpinner} />
                    <ThemedText style={styles.watchlistButtonText}>
                      Adding...
                    </ThemedText>
                  </View>
                ) : (
                  <ThemedText style={styles.watchlistButtonText}>
                    {isInWatchlist ? 'In Watchlist' : 'Add to Watchlist'}
                  </ThemedText>
                )}
              </Pressable>

              {addedMessage && (
                <ThemedText style={styles.addedMessageText}>
                  {addedMessage}
                </ThemedText>
              )}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
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
  searchStatusContainer: {
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '90%',
    backgroundColor: '#0B0218',
    borderRadius: 22,
    padding: 16,
  },
  modalPoster: {
    width: '100%',
    height: 260,
    borderRadius: 16,
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 20,
    color: '#FFFFFF',
    fontWeight: '700',
    marginBottom: 8,
  },
  modalOverview: {
    fontSize: 13,
    color: 'rgba(228,206,255,0.8)',
    marginBottom: 12,
  },
  modalVibesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  modalClose: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 4,
  },
  vibePill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    marginRight: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(58, 10, 105, 0.95)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.85)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  vibePillText: {
    fontSize: 12,
    color: '#FFF7FF',
  },
  watchlistButton: {
    backgroundColor: 'rgba(126, 52, 255, 1)',
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
  },
  watchlistButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  watchlistButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchlistButtonSpinner: {
    marginRight: 8,
  },
  addedMessageText: {
    marginTop: 8,
    fontSize: 12,
    color: 'rgba(228, 255, 228, 0.9)',
    textAlign: 'center',
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  matchPillLarge: {
    backgroundColor: 'rgba(126, 52, 255, 1)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  matchPillLargeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  whyThisText: {
    fontSize: 13,
    color: 'rgba(255, 220, 255, 0.9)',
    marginBottom: 16,
  },
});

export {};
