// app/user/[id].tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/providers/AuthProvider';

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL;

type ProfileRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  created_at: string | null;
  watchlist_movie_ids: number[] | null;
};

export default function OtherUserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { supabase, user } = useAuth();

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preferenceVector, setPreferenceVector] = useState<number[] | null>(null);

  const [watchlistMovies, setWatchlistMovies] = useState<any[]>([]);
  const [watchHistory, setWatchHistory] = useState<any[]>([]);
  const [watchHistoryLoading, setWatchHistoryLoading] = useState(false);
  const [watchHistoryError, setWatchHistoryError] = useState<string | null>(null);
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState<any | null>(null);

  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);

  const [followStatus, setFollowStatus] = useState<'none' | 'requested' | 'following'>('none');
  const [followSubmitting, setFollowSubmitting] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !id) return;

    const loadProfile = async () => {
      try {
        setLoading(true);
        setError(null);

        const { data, error } = await supabase
          .from('profiles')
          .select(
            'id, display_name, email, avatar_url, created_at, watchlist_movie_ids',
          )
          .eq('id', id)
          .maybeSingle();

        if (error) {
          console.error('Error loading other user profile', error);
          setError('Unable to load user right now.');
          setProfile(null);
        } else {
          setProfile(data as ProfileRow | null);
        }

        // Load this user's preference vector for vibe pills
        const { data: prefsData, error: prefsError } = await supabase
          .from('user_preferences')
          .select('preference_vector')
          .eq('user_id', id)
          .maybeSingle();

        if (prefsError) {
          console.warn('Error loading other user preferences', prefsError);
        } else if (prefsData?.preference_vector) {
          setPreferenceVector(prefsData.preference_vector as number[]);
        }

        // Watchlist movies
        const watchlistIds = (data?.watchlist_movie_ids || []) as (number[] | string[]);
        const idsArray = Array.isArray(watchlistIds) ? watchlistIds : [];

        if (idsArray.length > 0) {
          const { data: moviesData, error: moviesError } = await supabase
            .from('movies')
            .select('*')
            .in('id', idsArray);

          if (moviesError) {
            console.error('Error loading watchlist movies for other user', moviesError);
            setWatchlistMovies([]);
          } else {
            setWatchlistMovies(moviesData || []);
          }
        } else {
          setWatchlistMovies([]);
        }

        // Watch history with joined movie + reaction
        setWatchHistoryLoading(true);
        setWatchHistoryError(null);

        const { data: historyData, error: historyError } = await supabase
          .from('watch_history')
          .select(`
            id,
            watched_at,
            movie:movies(*),
            reaction:user_movie_reactions(rating, reaction, review)
          `)
          .eq('user_id', id)
          .order('watched_at', { ascending: false })
          .limit(20);

        if (historyError) {
          console.error('Error loading other user watch history', historyError);
          setWatchHistoryError('Failed to load watch history.');
          setWatchHistory([]);
        } else {
          setWatchHistory(historyData || []);
        }

        // FOLLOWING: this user → others
        const { count: followingRes, error: followingErr } = await supabase
          .from('user_relationships')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', id)
          .eq('status', 'accepted');

        if (followingErr) {
          console.error('Error loading following count for other user', followingErr);
          setFollowingCount(0);
        } else if (typeof followingRes === 'number') {
          setFollowingCount(followingRes);
        }

        // FOLLOWERS: others → this user
        const { count: followersRes, error: followersErr } = await supabase
          .from('user_relationships')
          .select('*', { count: 'exact', head: true })
          .eq('target_user_id', id)
          .eq('status', 'accepted');

        if (followersErr) {
          console.error('Error loading followers count for other user', followersErr);
          setFollowersCount(0);
        } else if (typeof followersRes === 'number') {
          setFollowersCount(followersRes);
        }

        // Relationship status: does the current user already follow / have a pending request?
        if (user && user.id !== id) {
          const { data: relData, error: relError } = await supabase
            .from('user_relationships')
            .select('status')
            .eq('user_id', user.id)
            .eq('target_user_id', id)
            .maybeSingle();

          if (relError) {
            console.warn('Error loading relationship status', relError);
          } else if (relData?.status === 'accepted') {
            setFollowStatus('following');
          } else if (relData?.status === 'requested') {
            setFollowStatus('requested');
          } else {
            setFollowStatus('none');
          }
        }
      } catch (e) {
        console.error('Unexpected error loading other user profile', e);
        setError('Something went wrong.');
        setProfile(null);
        setWatchlistMovies([]);
        setWatchHistory([]);
        setWatchHistoryError('Failed to load watch history.');
      } finally {
        setLoading(false);
        setWatchHistoryLoading(false);
      }
    };

    loadProfile();
  }, [supabase, id]);

  // Build avatar URL similarly to your own profile screen
  let avatarUri: string | undefined;
  if (profile?.avatar_url) {
    if (profile.avatar_url.startsWith('http')) {
      avatarUri = profile.avatar_url;
    } else if (supabase) {
      try {
        const { data } = supabase.storage
          .from('avatars')
          .getPublicUrl(profile.avatar_url);
        if (data?.publicUrl) {
          avatarUri = data.publicUrl;
        }
      } catch (e) {
        console.warn('Error building avatar URL for other user profile', e);
      }
    }
  }
  if (!avatarUri && profile?.display_name) {
    avatarUri =
      'https://api.dicebear.com/8.x/thumbs/svg?seed=' +
      encodeURIComponent(profile.display_name);
  }

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

    return pills.slice(0, 4);
  }, [preferenceVector]);


  const handleFollow = async () => {
    if (!supabase || !id) return;
    if (followSubmitting) return;

    if (!user || user.id === id) {
      // Cannot follow yourself or unauthenticated
      return;
    }

    try {
      setFollowSubmitting(true);
      setFollowError(null);

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch(`${API_BASE_URL}/v1/relationships/request`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_id: user.id,
          target_user_id: id,
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        console.error('Follow request failed', txt);
        setFollowError('Could not send follow request. Please try again.');
        return;
      }

      // Assume the request is now pending; UI shows "Requested"
      setFollowStatus('requested');
    } catch (e) {
      console.error('Unexpected error sending follow request', e);
      setFollowError('Something went wrong while sending follow request.');
    } finally {
      setFollowSubmitting(false);
    }
  };

  const name = profile?.display_name || 'User';
  const email = profile?.email || '';
  const watchlistCount = Array.isArray(profile?.watchlist_movie_ids)
    ? profile!.watchlist_movie_ids!.length
    : 0;

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

  return (
    <ThemedView style={styles.screen}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable style={styles.backButton} onPress={() => {
            // Always return to the Blend tab
            router.replace('/(tabs)/blend');
        }}>
          <ThemedText type="default" style={styles.backLabel}>
            ‹ Back
          </ThemedText>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <ThemedText
            type="default"
            style={styles.loaderText}
          >
            Loading profile...
          </ThemedText>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <ThemedText type="default" style={styles.errorText}>
            {error}
          </ThemedText>
        </View>
      ) : !profile ? (
        <View style={styles.center}>
          <ThemedText type="default" style={styles.errorText}>
            User not found.
          </ThemedText>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.avatarWrapper}>
              <Image
                source={{ uri: avatarUri }}
                style={styles.avatar}
                contentFit="cover"
              />
            </View>

            <ThemedText type="title" style={styles.name}>
              {name}
            </ThemedText>

            {email ? (
              <ThemedText type="default" style={styles.email}>
                {email}
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
                Their vibe
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

          {/* Followers / Following row */}
          <View style={styles.followRow}>
            <View style={styles.followBlock}>
              <ThemedText type="defaultSemiBold" style={styles.followCount}>
                {followersCount}
              </ThemedText>
              <ThemedText type="default" style={styles.followLabel}>
                Followers
              </ThemedText>
            </View>
            <View style={styles.followBlock}>
              <ThemedText type="defaultSemiBold" style={styles.followCount}>
                {followingCount}
              </ThemedText>
              <ThemedText type="default" style={styles.followLabel}>
                Following
              </ThemedText>
            </View>
          </View>

          {/* Follow button (outbound) */}
          {user && user.id !== profile.id && (
            <View style={styles.followActionsRow}>
              <Pressable
                style={[
                  styles.followButton,
                  (followStatus !== 'none' || followSubmitting) && styles.followButtonDisabled,
                ]}
                disabled={followStatus !== 'none' || followSubmitting}
                onPress={handleFollow}
              >
                <ThemedText type="defaultSemiBold" style={styles.followButtonLabel}>
                  {followStatus === 'following'
                    ? 'Following'
                    : followStatus === 'requested'
                    ? 'Requested'
                    : followSubmitting
                    ? 'Sending...'
                    : 'Follow'}
                </ThemedText>
              </Pressable>
            </View>
          )}

          {followError && (
            <View style={styles.followErrorContainer}>
              <ThemedText type="default" style={styles.followErrorText}>
                {followError}
              </ThemedText>
            </View>
          )}

          <View style={styles.headerDivider} />

          {/* Recently watched rail */}
          <View style={styles.section}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              Recently watched
            </ThemedText>
            {watchHistoryLoading ? (
              <ActivityIndicator />
            ) : watchHistoryError ? (
              <ThemedText type="default" style={styles.sectionBody}>
                {watchHistoryError}
              </ThemedText>
            ) : watchHistory.length === 0 ? (
              <ThemedText type="default" style={styles.sectionBody}>
                This user hasn&apos;t logged any watched movies yet.
              </ThemedText>
            ) : (
              <FlatList
                data={watchHistory}
                horizontal
                keyExtractor={(item: any) => String(item.id)}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.railListContent}
                renderItem={({ item }) => {
                  const movie = item.movie;
                  if (!movie) return null;

                  const title: string = movie.title || '';
                  const releaseDate: string | null = movie.release_date || null;
                  const year = releaseDate ? releaseDate.slice(0, 4) : '';
                  const posterPath: string | null = movie.poster_path || null;
                  const posterUrl = posterPath
                    ? `https://image.tmdb.org/t/p/w500${posterPath}`
                    : 'https://via.placeholder.com/300x450.png?text=No+Image';

                  return (
                    <Pressable
                      style={styles.railCard}
                      onPress={() => setSelectedHistoryEntry(item)}
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
                        {year ? (
                          <ThemedText type="default" style={styles.railCardMeta}>
                            {year}
                          </ThemedText>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                }}
              />
            )}
          </View>

          {/* Watchlist rail */}
          <View style={styles.section}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              Watchlist
            </ThemedText>
            {watchlistMovies.length === 0 ? (
              <ThemedText type="default" style={styles.sectionBody}>
                This user doesn&apos;t have any movies in their watchlist yet.
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

          {/* Watch history details modal */}
          {selectedHistoryEntry && (
            <Modal
              transparent
              animationType="fade"
              visible
              onRequestClose={() => setSelectedHistoryEntry(null)}
            >
              <View style={styles.modalOverlay}>
                <View style={styles.historyModalContainer}>
                  <Pressable
                    style={styles.modalClose}
                    onPress={() => setSelectedHistoryEntry(null)}
                  >
                    <ThemedText style={{ color: '#fff' }}>✕</ThemedText>
                  </Pressable>

                  {(() => {
                    const movie = selectedHistoryEntry.movie;
                    const reaction = selectedHistoryEntry.reaction;
                    const watchedAt = selectedHistoryEntry.watched_at;

                    const posterUrl = movie?.poster_path
                      ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
                      : null;

                    const date = watchedAt ? new Date(watchedAt) : null;
                    const dateLabel = date
                      ? date.toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : null;

                    let emojiLabel: string | null = null;
                    if (reaction?.reaction === 'like') emojiLabel = '😊 Like';
                    else if (reaction?.reaction === 'meh') emojiLabel = '😐 Meh';
                    else if (reaction?.reaction === 'dislike') emojiLabel = '☹️ Dislike';

                    return (
                      <>
                        {posterUrl && (
                          <Image
                            source={{ uri: posterUrl }}
                            style={styles.historyModalPoster}
                            contentFit="cover"
                          />
                        )}

                        <ThemedText type="title" style={styles.historyModalTitle}>
                          {movie?.title}
                        </ThemedText>

                        {dateLabel && (
                          <ThemedText type="default" style={styles.historyModalSub}>
                            Watched on {dateLabel}
                          </ThemedText>
                        )}

                        {typeof reaction?.rating === 'number' && reaction.rating > 0 && (
                          <View style={styles.historyRatingRow}>
                            {[1, 2, 3, 4, 5].map((star) => (
                              <ThemedText
                                key={star}
                                style={[
                                  styles.historyRatingStar,
                                  reaction.rating >= star && styles.historyRatingStarActive,
                                ]}
                              >
                                {reaction.rating >= star ? '★' : '☆'}
                              </ThemedText>
                            ))}
                          </View>
                        )}

                        {emojiLabel && (
                          <View style={styles.historyReactionPill}>
                            <ThemedText style={styles.historyReactionText}>
                              {emojiLabel}
                            </ThemedText>
                          </View>
                        )}

                        {reaction?.review && reaction.review.trim().length > 0 && (
                          <ThemedText type="default" style={styles.historyReviewText}>
                            {reaction.review}
                          </ThemedText>
                        )}
                      </>
                    );
                  })()}
                </View>
              </View>
            </Modal>
          )}
        </ScrollView>
      )}
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
  topBar: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
  },
  backLabel: {
    fontSize: 14,
    color: 'rgba(228,206,255,0.9)',
  },
  scroll: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderText: {
    marginTop: 8,
    fontSize: 14,
    color: 'rgba(228, 206, 255, 0.85)',
  },
  errorText: {
    color: '#FF8E9E',
    fontSize: 12,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  followRow: {
    marginTop: 8,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 40,
  },
  followBlock: {
    alignItems: 'center',
  },
  followCount: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  followLabel: {
    fontSize: 12,
    color: 'rgba(228, 206, 255, 0.7)',
  },
  followActionsRow: {
    marginTop: 4,
    marginBottom: 8,
    alignItems: 'center',
  },
  followButton: {
    paddingHorizontal: 22,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(126, 52, 255, 1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 200, 255, 0.9)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 8,
  },
  followButtonDisabled: {
    backgroundColor: 'rgba(60, 35, 95, 0.9)',
    borderColor: 'rgba(200, 170, 240, 0.8)',
  },
  followButtonLabel: {
    fontSize: 13,
    color: '#FFFFFF',
  },
  followErrorContainer: {
    marginTop: 4,
    alignItems: 'center',
  },
  followErrorText: {
    fontSize: 11,
    color: '#FF8E9E',
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
  name: {
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
  section: {
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(17, 4, 33, 0.95)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.45)',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 15,
    color: '#FFFFFF',
    marginBottom: 6,
  },
  sectionBody: {
    fontSize: 12,
    color: 'rgba(228,206,255,0.85)',
  },
  railListContent: {
    paddingRight: 4,
    paddingTop: 8,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  historyModalContainer: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    backgroundColor: '#0B0218',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.6)',
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 12,
  },
  modalClose: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 10,
    padding: 6,
  },
  historyModalPoster: {
    width: '100%',
    height: 220,
    borderRadius: 18,
    marginBottom: 12,
  },
  historyModalTitle: {
    fontSize: 20,
    color: '#FFFFFF',
    marginBottom: 4,
  },
  historyModalSub: {
    fontSize: 12,
    color: 'rgba(228, 206, 255, 0.8)',
    marginBottom: 10,
  },
  historyRatingRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  historyRatingStar: {
    fontSize: 20,
    color: 'rgba(120, 90, 160, 0.9)',
    marginRight: 4,
  },
  historyRatingStarActive: {
    color: '#FFD76A',
  },
  historyReactionPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(58, 10, 105, 0.95)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.85)',
    marginBottom: 10,
  },
  historyReactionText: {
    fontSize: 12,
    color: '#FFF7FF',
  },
  historyReviewText: {
    fontSize: 13,
    color: 'rgba(228, 206, 255, 0.9)',
    marginTop: 4,
  },
});