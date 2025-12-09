import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  View,
  RefreshControl,
  Pressable,
  Modal,
  TouchableOpacity,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/providers/AuthProvider';
import { useFocusEffect, useRouter } from 'expo-router';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL;

type ProfileRow = {
  display_name: string | null;
  avatar_url: string | null;
  created_at: string | null;
  watchlist_movie_ids: number[] | string[] | null;
  email: string | null;
};

export default function ProfileScreen() {
  const { user, supabase } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [watchlistMovies, setWatchlistMovies] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [preferenceVector, setPreferenceVector] = useState<number[] | null>(null);

  const [watchHistory, setWatchHistory] = useState<any[]>([]);
  const [watchHistoryLoading, setWatchHistoryLoading] = useState(false);
  const [watchHistoryError, setWatchHistoryError] = useState<string | null>(null);
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState<any | null>(null);

  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);

  // Modals + lists
  const [showFollowersModal, setShowFollowersModal] = useState(false);
  const [showFollowingModal, setShowFollowingModal] = useState(false);
  const [showRequestsModal, setShowRequestsModal] = useState(false);
  const [followersList, setFollowersList] = useState<any[]>([]);
  const [followingList, setFollowingList] = useState<any[]>([]);
  const [requestsList, setRequestsList] = useState<any[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [listsLoading, setListsLoading] = useState(false);

  const loadProfile = async () => {
    if (!user || !supabase) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setWatchHistoryLoading(true);
    setWatchHistoryError(null);
    
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

      // Fetch watch history with joined movie + reaction
      const { data: historyData, error: historyError } = await supabase
        .from('watch_history')
        .select(`
          id,
          watched_at,
          movie:movies(*),
          reaction:user_movie_reactions(rating, reaction, review)
        `)
        .eq('user_id', user.id)
        .order('watched_at', { ascending: false })
        .limit(20);

      if (historyError) {
        console.error('Error loading watch history', historyError);
        setWatchHistoryError('Failed to load watch history.');
        setWatchHistory([]);
      } else {
        setWatchHistory(historyData || []);
      }

      // FOLLOWING: current user → others
      const { count: followingRes, error: followingErr } = await supabase
        .from('user_relationships')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'accepted');

      if (followingErr) {
        console.error('Error loading following count', followingErr);
        setFollowingCount(0);
      } else if (typeof followingRes === 'number') {
        setFollowingCount(followingRes);
      }

      // FOLLOWERS: others → current user
      const { count: followersRes, error: followersErr } = await supabase
        .from('user_relationships')
        .select('*', { count: 'exact', head: true })
        .eq('target_user_id', user.id)
        .eq('status', 'accepted');

      if (followersErr) {
        console.error('Error loading followers count', followersErr);
        setFollowersCount(0);
      } else if (typeof followersRes === 'number') {
        setFollowersCount(followersRes);
      }

      // also reset lazy lists so they refresh when opened
      setFollowersList([]);
      setFollowingList([]);
    } catch (e) {
      console.error('Unexpected error loading profile', e);
      setError('Something went wrong while loading your profile.');
      setWatchHistoryError('Failed to load watch history.');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
      setWatchHistoryLoading(false);
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

  const loadFollowersList = useCallback(async () => {
    if (!supabase || !user) return;
    setListsLoading(true);
    try {
      const { data: rels } = await supabase
        .from('user_relationships')
        .select('id, user_id, created_at')
        .eq('target_user_id', user.id)
        .eq('status', 'accepted');

      const ids = (rels || []).map((r: any) => r.user_id).filter(Boolean);
      if (ids.length === 0) {
        setFollowersList([]);
        return;
      }

      const { data: profs } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', ids);

      setFollowersList((profs || []).map((p: any) => ({ ...p })));
    } catch (e) {
      console.error('Error loading followers list', e);
      setFollowersList([]);
    } finally {
      setListsLoading(false);
    }
  }, [supabase, user]);

  const loadFollowingList = useCallback(async () => {
    if (!supabase || !user) return;
    setListsLoading(true);
    try {
      const { data: rels } = await supabase
        .from('user_relationships')
        .select('id, target_user_id, created_at')
        .eq('user_id', user.id)
        .eq('status', 'accepted');

      const ids = (rels || []).map((r: any) => r.target_user_id).filter(Boolean);
      if (ids.length === 0) {
        setFollowingList([]);
        return;
      }

      const { data: profs } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', ids);

      setFollowingList((profs || []).map((p: any) => ({ ...p })));
    } catch (e) {
      console.error('Error loading following list', e);
      setFollowingList([]);
    } finally {
      setListsLoading(false);
    }
  }, [supabase, user]);

  const loadFollowRequests = useCallback(async () => {
    if (!supabase || !user) return;
    setRequestsLoading(true);
    try {
      const { data: rels } = await supabase
        .from('user_relationships')
        .select('id, user_id, created_at')
        .eq('target_user_id', user.id)
        .eq('status', 'pending');

      const requesterIds = (rels || []).map((r: any) => r.user_id).filter(Boolean);
      if (requesterIds.length === 0) {
        setRequestsList([]);
        return;
      }

      const { data: profs } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', requesterIds);

      const relsById: Record<string, any> = {};
      (rels || []).forEach((r: any) => {
        relsById[r.user_id] = r;
      });

      setRequestsList((profs || []).map((p: any) => ({
        ...p,
        relationship_id: relsById[p.id]?.id,
      })));
    } catch (e) {
      console.error('Error loading follow requests', e);
      setRequestsList([]);
    } finally {
      setRequestsLoading(false);
    }
  }, [supabase, user]);

  // Accept a follow request (the current user is the target)
  const acceptRequest = async (relationshipId: string, requesterId: string) => {
    if (!supabase || !user) return;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`${API_BASE_URL}/v1/relationships/respond`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_id: user.id,
          relationship_id: relationshipId,
          action: 'accept',
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        console.error('Accept request failed', txt);
        return false;
      }

      // Update local UI: mark this request as accepted so we can show "Follow back" action
      setRequestsList((prev) => prev.map((p) => (p.relationship_id === relationshipId ? { ...p, accepted: true } : p)));
      await loadProfile();
      await loadFollowersList();
      return true;
    } catch (e) {
      console.error('Error accepting request', e);
      return false;
    }
  };

  const rejectRequest = async (relationshipId: string) => {
    if (!supabase || !user) return;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`${API_BASE_URL}/v1/relationships/respond`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_id: user.id,
          relationship_id: relationshipId,
          action: 'reject',
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        console.error('Reject request failed', txt);
        return false;
      }

      await loadFollowRequests();
      return true;
    } catch (e) {
      console.error('Error rejecting request', e);
      return false;
    }
  };

  const followBack = async (targetUserId: string) => {
    if (!supabase || !user) return false;
    try {
      // insert accepted relationship from current user -> target
      const { error } = await supabase
        .from('user_relationships')
        .insert({ user_id: user.id, target_user_id: targetUserId, status: 'accepted' });

      if (error) {
        console.error('Follow back failed', error);
        return false;
      }

      // refresh following list
      await loadFollowingList();
      return true;
    } catch (e) {
      console.error('Error following back', e);
      return false;
    }
  };

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

  const avatarUri = useMemo(() => {
    // If we have an avatar_url from the profile
    if (profile?.avatar_url) {
      // Case 1: already a full URL
      if (profile.avatar_url.startsWith('http')) {
        return profile.avatar_url;
      }

      // Case 2: it's a storage path like "user-id/123.jpg"
      try {
        if (supabase) {
          const { data } = supabase.storage
            .from('avatars')
            .getPublicUrl(profile.avatar_url);
        }
      } catch (e) {
        console.warn('Error building avatar public URL', e);
      }
    }

    // Fallback placeholder
    return 'https://via.placeholder.com/300x300.png?text=Profile';
  }, [profile?.avatar_url, supabase]);

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
      {/* Bell in top-right */}
      <TouchableOpacity
        style={styles.bellButton}
        onPress={async () => {
          setShowRequestsModal(true);
          await loadFollowRequests();
        }}
      >
        <Ionicons name="notifications-outline" size={22} color="#E6B3FF" />
        {requestsList.length > 0 && (
          <View style={styles.notificationBadge}>
            <ThemedText style={styles.notificationBadgeText}>{requestsList.length}</ThemedText>
          </View>
        )}
      </TouchableOpacity>
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
            <Image source={{ uri: avatarUri }} style={styles.avatar} contentFit="cover" />
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

          {/* Followers / Following Row */}
          <View style={styles.followRow}>
            <Pressable
              style={styles.followBlock}
              onPress={async () => {
                setShowFollowersModal(true);
                await loadFollowersList();
              }}
            >
              <ThemedText type="defaultSemiBold" style={styles.followCount}>
                {followersCount}
              </ThemedText>
              <ThemedText type="default" style={styles.followLabel}>Followers</ThemedText>
            </Pressable>

            <Pressable
              style={styles.followBlock}
              onPress={async () => {
                setShowFollowingModal(true);
                await loadFollowingList();
              }}
            >
              <ThemedText type="defaultSemiBold" style={styles.followCount}>
                {followingCount}
              </ThemedText>
              <ThemedText type="default" style={styles.followLabel}>Following</ThemedText>
            </Pressable>
          </View>
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

        {/* Recently watched rail */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText type="title" style={styles.sectionTitle}>
              Recently watched
            </ThemedText>
          </View>
          {watchHistoryLoading ? (
            <ActivityIndicator />
          ) : watchHistory.length === 0 ? (
            <ThemedText type="default" style={styles.emptyStateText}>
              You haven&apos;t logged any movies as watched yet.
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

      {/* Followers modal */}
      <Modal transparent animationType="slide" visible={showFollowersModal} onRequestClose={() => setShowFollowersModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalListContainer}>
            <View style={styles.modalHeaderRow}>
              <ThemedText type="title" style={styles.sectionTitle}>Followers</ThemedText>
              <Pressable onPress={() => setShowFollowersModal(false)} style={styles.modalClose}>
                <ThemedText style={{ color: '#fff' }}>✕</ThemedText>
              </Pressable>
            </View>
            {listsLoading ? (
              <ActivityIndicator />
            ) : followersList.length === 0 ? (
              <ThemedText type="default">No followers yet.</ThemedText>
            ) : (
              <FlatList
                data={followersList}
                keyExtractor={(i: any) => String(i.id)}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.userRow}
                    onPress={() => {
                      setShowFollowersModal(false);
                      router.push(`/user/${item.id}`);
                    }}
                  >
                    <Image source={{ uri: item.avatar_url || 'https://via.placeholder.com/48' }} style={styles.userAvatar} />
                    <ThemedText style={styles.userName}>{item.display_name || 'User'}</ThemedText>
                  </Pressable>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Following modal */}
      <Modal transparent animationType="slide" visible={showFollowingModal} onRequestClose={() => setShowFollowingModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalListContainer}>
            <View style={styles.modalHeaderRow}>
              <ThemedText type="title" style={styles.sectionTitle}>Following</ThemedText>
              <Pressable onPress={() => setShowFollowingModal(false)} style={styles.modalClose}>
                <ThemedText style={{ color: '#fff' }}>✕</ThemedText>
              </Pressable>
            </View>
            {listsLoading ? (
              <ActivityIndicator />
            ) : followingList.length === 0 ? (
              <ThemedText type="default">You are not following anyone yet.</ThemedText>
            ) : (
              <FlatList
                data={followingList}
                keyExtractor={(i: any) => String(i.id)}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.userRow}
                    onPress={() => {
                      setShowFollowingModal(false);
                      router.push(`/user/${item.id}`);
                    }}
                  >
                    <Image source={{ uri: item.avatar_url || 'https://via.placeholder.com/48' }} style={styles.userAvatar} />
                    <ThemedText style={styles.userName}>{item.display_name || 'User'}</ThemedText>
                  </Pressable>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Follow requests modal */}
      <Modal transparent animationType="slide" visible={showRequestsModal} onRequestClose={() => setShowRequestsModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalListContainer}>
            <View style={styles.modalHeaderRow}>
              <ThemedText type="title" style={styles.sectionTitle}>Follow requests</ThemedText>
              <Pressable onPress={() => setShowRequestsModal(false)} style={styles.modalClose}>
                <ThemedText style={{ color: '#fff' }}>✕</ThemedText>
              </Pressable>
            </View>
            {requestsLoading ? (
              <ActivityIndicator />
            ) : requestsList.length === 0 ? (
              <ThemedText type="default">No pending requests.</ThemedText>
            ) : (
              <FlatList
                data={requestsList}
                keyExtractor={(i: any) => String(i.id)}
                renderItem={({ item }) => (
                  <View style={styles.requestRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Image source={{ uri: item.avatar_url || 'https://via.placeholder.com/48' }} style={styles.userAvatar} />
                      <ThemedText style={styles.userName}>{item.display_name || 'User'}</ThemedText>
                    </View>
                    <View style={styles.requestActions}>
                      {item.accepted ? (
                        <>
                          <ThemedText style={{ color: 'rgba(228,206,255,0.8)', marginRight: 8 }}>Accepted</ThemedText>
                          <Pressable
                            style={[styles.actionButton, styles.actionButtonPrimary]}
                            onPress={async () => {
                              await followBack(item.id);
                            }}
                          >
                            <ThemedText style={styles.actionButtonLabel}>Follow Back</ThemedText>
                          </Pressable>
                        </>
                      ) : (
                        <>
                          <Pressable
                            style={[styles.actionButton, styles.actionButtonPrimary]}
                            onPress={async () => {
                              if (!item.relationship_id) return;
                              await acceptRequest(item.relationship_id, item.id);
                            }}
                          >
                            <ThemedText style={styles.actionButtonLabel}>Accept</ThemedText>
                          </Pressable>
                          <Pressable
                            style={styles.actionButton}
                            onPress={async () => {
                              if (!item.relationship_id) return;
                              await rejectRequest(item.relationship_id);
                            }}
                          >
                            <ThemedText style={styles.actionButtonLabel}>Reject</ThemedText>
                          </Pressable>
                        </>
                      )}
                    </View>
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
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
  followRow: {
    marginTop: 12,
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
  bellButton: {
    marginLeft: 12,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    right: 20,
    top: 28,
  },
  notificationBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#FF6B6B',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  notificationBadgeText: {
    fontSize: 10,
    color: '#FFFFFF',
  },
  modalListContainer: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 16,
    backgroundColor: '#0B0218',
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.6)',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  userAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
  },
  userName: {
    fontSize: 14,
    color: '#FFFFFF',
  },
  requestRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  requestActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'transparent',
  },
  actionButtonPrimary: {
    backgroundColor: 'rgba(181, 120, 255, 0.95)',
  },
  actionButtonLabel: {
    color: '#FFFFFF',
    fontSize: 13,
  },
});

export {};
