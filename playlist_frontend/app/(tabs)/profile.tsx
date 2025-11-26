import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  View,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/providers/AuthProvider';
import { useFocusEffect } from 'expo-router';

type ProfileRow = {
  display_name: string | null;
  avatar_url: string | null;
  created_at: string | null;
  watchlist_movie_ids: number[] | string[] | null;
  email: string | null;
};

export default function ProfileScreen() {
  const { user, supabase } = useAuth();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [watchlistMovies, setWatchlistMovies] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [preferenceVector, setPreferenceVector] = useState<number[] | null>(null);

  const loadProfile = async () => {
    if (!user || !supabase) {
      setIsLoading(false);
      return;
    }

    try {
      setError(null);

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('display_name, avatar_url, created_at, watchlist_movie_ids, email')
        .eq('id', user.id)
        .maybeSingle();

      if (profileError) {
        console.error('Error loading profile', profileError);
        setError('Unable to load your profile right now.');
        return;
      }

      setProfile(profileData as ProfileRow);

      const { data: prefsData } = await supabase
        .from('user_preferences')
        .select('preference_vector')
        .eq('user_id', user.id)
        .maybeSingle();

      if (prefsData?.preference_vector) {
        setPreferenceVector(prefsData.preference_vector as number[]);
      }

      const watchlistIds = (profileData?.watchlist_movie_ids || []) as (number[] | string[]);
      const idsArray = Array.isArray(watchlistIds) ? watchlistIds : [];

      if (idsArray.length > 0) {
        const { data: moviesData } = await supabase
          .from('movies')
          .select('*')
          .in('id', idsArray);

        setWatchlistMovies(moviesData || []);
      } else {
        setWatchlistMovies([]);
      }
    } catch (e) {
      console.error('Unexpected error loading profile', e);
      setError('Something went wrong while loading your profile.');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    loadProfile();
  }, [user]);

  useFocusEffect(
    React.useCallback(() => {
      loadProfile();
    }, [user])
  );

  const formattedDate = useMemo(() => {
    if (!profile?.created_at) return null;
    const d = new Date(profile.created_at);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }, [profile?.created_at]);

  const avatarSource =
    profile?.avatar_url ||
    'https://via.placeholder.com/300x300.png?text=Profile';

  const vibePills = useMemo(() => {
    if (!preferenceVector || preferenceVector.length < 10) return [];

    const v = preferenceVector;

    const pills: string[] = [];

    const addAxis = (value: number, positive: string, negative: string, threshold = 0.35) => {
      if (value > threshold) pills.push(positive);
      else if (value < -threshold) pills.push(negative);
    };

    // 0: Mainstream vs Arthouse
    addAxis(v[0], 'Arthouse lean', 'Mainstream crowd-pleaser');

    // 1: Light/Fun vs Dark/Serious (v[1] high = dark)
    addAxis(v[1], 'Dark & moody', 'Light & feel-good');

    // 2: Fast-paced vs Slow-burn (v[2] high = slow-burn)
    addAxis(v[2], 'Slow-burn stories', 'Fast-paced energy');

    // 6: Realistic vs Fantastical (v[6] high = fantastical)
    addAxis(v[6], 'Fantastical worlds', 'Grounded & realistic');

    // 7: Optimistic vs Bleak (v[7] high = optimistic)
    addAxis(v[7], 'Optimistic endings', 'Bleak & heavy');

    // 9: Comfort vs Challenging (v[9] high = comfort)
    addAxis(v[9], 'Comfort rewatches', 'Challenging watches');

    // Limit to 4 strongest to keep it clean
    return pills.slice(0, 4);
  }, [preferenceVector]);

  const renderWatchlistCard = (movie: any) => {
    const title: string = movie.title || '';
    const releaseDate: string | null = movie.release_date || null;
    const year = releaseDate ? releaseDate.slice(0, 4) : '';
    const posterPath: string | null = movie.poster_path || null;
    const posterUrl = posterPath
      ? `https://image.tmdb.org/t/p/w500${posterPath}`
      : 'https://via.placeholder.com/300x450.png?text=No+Image';

    return (
      <View style={styles.railCard}>
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
          {year ? (
            <ThemedText type="default" style={styles.railCardMeta}>
              {year}
            </ThemedText>
          ) : null}
        </View>
      </View>
    );
  };

  if (isLoading) {
    return (
      <ThemedView style={styles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator />
          <ThemedText type="default" style={styles.loaderText}>
            Loading your profile...
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadProfile();
            }}
            tintColor="#E6B3FF"
          />
        }
      >
        {/* Profile header */}
        <View style={styles.header}>
          <View style={styles.avatarWrapper}>
            <Image source={{ uri: avatarSource }} style={styles.avatar} contentFit="cover" />
          </View>
          <ThemedText type="title" style={styles.displayName}>
            {profile?.display_name || 'Your profile'}
          </ThemedText>
          {user?.email || profile?.email ? (
            <ThemedText type="default" style={styles.email}>
              {user?.email || profile?.email}
            </ThemedText>
          ) : null}
          {formattedDate ? (
            <ThemedText type="default" style={styles.joinedText}>
              Joined {formattedDate}
            </ThemedText>
          ) : null}
        </View>

        {vibePills.length > 0 && (
          <View style={styles.vibeSection}>
            <ThemedText type="defaultSemiBold" style={styles.vibeTitle}>
              Your vibe
            </ThemedText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.vibePillsRow}
            >
              {vibePills.map((pill) => (
                <View key={pill} style={styles.vibePill}>
                  <ThemedText type="defaultSemiBold" style={styles.vibePillText}>
                    {pill}
                  </ThemedText>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.headerDivider} />

        {error ? (
          <View style={styles.errorContainer}>
            <ThemedText type="default" style={styles.errorText}>
              {error}
            </ThemedText>
          </View>
        ) : null}

        {/* Watchlist rail */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText type="title" style={styles.sectionTitle}>
              Watchlist
            </ThemedText>
          </View>
          {watchlistMovies.length === 0 ? (
            <ThemedText type="default" style={styles.emptyStateText}>
              You don&apos;t have any movies in your watchlist yet.
            </ThemedText>
          ) : (
            <FlatList
              data={watchlistMovies}
              horizontal
              keyExtractor={(item: any) => String(item.id)}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.railListContent}
              renderItem={({ item }) => renderWatchlistCard(item)}
            />
          )}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#05010B',
    paddingTop: 72,
    paddingBottom: 16,
  },
  scroll: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderText: {
    marginTop: 8,
    fontSize: 14,
    color: 'rgba(228, 206, 255, 0.85)',
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarWrapper: {
    width: 120,
    height: 120,
    borderRadius: 60,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: 'rgba(255, 160, 255, 0.9)',
    backgroundColor: 'rgba(24, 9, 44, 1)',
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.6,
    shadowRadius: 18,
    elevation: 10,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  displayName: {
    fontSize: 22,
    color: '#FFFFFF',
    marginBottom: 4,
    letterSpacing: -0.02,
    textAlign: 'center',
  },
  email: {
    fontSize: 14,
    color: 'rgba(228, 206, 255, 0.9)',
    marginBottom: 2,
    textAlign: 'center',
  },
  joinedText: {
    fontSize: 13,
    color: 'rgba(228, 206, 255, 0.7)',
    textAlign: 'center',
  },
  vibeSection: {
    marginBottom: 12,
    alignItems: 'flex-start',
    width: '100%',
  },
  vibeTitle: {
    fontSize: 14,
    color: '#FFFFFF',
    marginBottom: 6,
    textAlign: 'left',
  },
  vibePillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    paddingRight: 12,
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
  headerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 160, 255, 0.25)',
    marginBottom: 16,
    marginHorizontal: 4,
  },
  errorContainer: {
    marginBottom: 16,
  },
  errorText: {
    fontSize: 12,
    color: '#FF8E9E',
  },
  section: {
    marginTop: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 18,
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
    marginBottom: 2,
  },
  railCardMeta: {
    fontSize: 11,
    color: '#F4ECFF',
  },
  emptyStateText: {
    fontSize: 13,
    color: 'rgba(228, 206, 255, 0.8)',
  },
});

export {};
