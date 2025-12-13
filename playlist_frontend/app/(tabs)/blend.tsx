import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  Alert,
  Dimensions,
  Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/providers/AuthProvider';
import { useRouter } from 'expo-router';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL;
if (!API_BASE_URL) {
  console.warn('EXPO_PUBLIC_API_URL is not defined. Blend preferences API will not work.');
}

export default function BlendScreen() {
  const { user, supabase } = useAuth();
  const router = useRouter();

  // Search and user selection
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<any[]>([]);
  const [followingList, setFollowingList] = useState<any[]>([]);
  const [followingLoading, setFollowingLoading] = useState(false);
  const [currentProfile, setCurrentProfile] = useState<any | null>(null);

  const followingIds = React.useMemo(() => new Set(followingList.map((u) => u.id)), [followingList]);
  const filteredResults = React.useMemo(
    () => results.filter((r) => !followingIds.has(r.id)),
    [results, followingIds]
  );

  // Blend computation and results
  const [viewMode, setViewMode] = useState<'search' | 'results'>('search');
  const [blendedTopPicks, setBlendedTopPicks] = useState<any[] | null>(null);
  const [blendedCategories, setBlendedCategories] = useState<Record<string, any[]> | null>(null);
  const [blendLoading, setBlendLoading] = useState(false);

  // Movie detail modal
  const [selectedMovie, setSelectedMovie] = useState<any | null>(null);

  const searchTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = async () => {
    if (!supabase) return;
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setResults([]);
      setSearchError(null);
      return;
    }

    try {
      setSearching(true);
      setSearchError(null);

      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url, email, watchlist_movie_ids')
        .ilike('display_name', `%${trimmed}%`)
        .neq('id', user?.id)
        .limit(25);

      if (error) {
        console.error('Error searching users', error);
        setSearchError('Something went wrong while searching users.');
        setResults([]);
      } else {
        setResults(data || []);
      }
    } catch (e) {
      console.error('Unexpected error searching users', e);
      setSearchError('Something went wrong while searching users.');
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  React.useEffect(() => {
    if (!supabase) return;

    const trimmed = searchQuery.trim();

    if (!trimmed) {
      setResults([]);
      setSearchError(null);
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      handleSearch();
    }, 250);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, supabase]);

  React.useEffect(() => {
    if (!supabase || !user) return;

    let isMounted = true;
    const loadCurrentProfile = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, display_name, avatar_url, email')
          .eq('id', user.id)
          .maybeSingle();
        if (error) throw error;
        if (isMounted) setCurrentProfile(data || null);
      } catch (e) {
        console.warn('[Blend] Could not load current profile', e);
        if (isMounted) setCurrentProfile(null);
      }
    };

    const loadFollowing = async () => {
      setFollowingLoading(true);
      try {
        const { data: rels, error } = await supabase
          .from('user_relationships')
          .select('target_user_id')
          .eq('user_id', user.id)
          .eq('status', 'accepted');

        if (error) throw error;

        const ids = (rels || []).map((r: any) => r.target_user_id).filter(Boolean);
        if (ids.length === 0) {
          if (isMounted) setFollowingList([]);
          return;
        }

        const { data: profs, error: profErr } = await supabase
          .from('profiles')
          .select('id, display_name, avatar_url, email, watchlist_movie_ids')
          .in('id', ids);

        if (profErr) throw profErr;

        if (isMounted) setFollowingList((profs || []).map((p: any) => ({ ...p })));
      } catch (e) {
        console.error('[Blend] Error loading following list', e);
        if (isMounted) setFollowingList([]);
      } finally {
        if (isMounted) setFollowingLoading(false);
      }
    };

    loadCurrentProfile();
    loadFollowing();
    return () => {
      isMounted = false;
    };
  }, [supabase, user]);

  const handlePressUser = (otherUserId: string) => {
    router.push(`/user/${otherUserId}?returnTab=blend`);
  };

  const handleStartBlend = (otherUser: any) => {
    if (!otherUser || !otherUser.id) return;
    setSelectedUsers((prev) => {
      const exists = prev.find((p) => p.id === otherUser.id);
      if (exists) return prev.filter((p) => p.id !== otherUser.id);
      return [...prev, otherUser];
    });
  };

  const clearSelection = () => {
    setSelectedUsers([]);
    setBlendedTopPicks(null);
    setBlendedCategories(null);
    setViewMode('search');
  };

  const computeBlended = async () => {
    if (!supabase || !user) return;
    if (!API_BASE_URL) {
      Alert.alert('Missing API base URL', 'EXPO_PUBLIC_API_URL is not set.');
      return;
    }
    const participantIds = [String(user.id), ...selectedUsers.map((s) => String(s.id))];
    setBlendLoading(true);
    try {
      // Fetch all preference vectors
      let prefById: Record<string, number[]> = {};
      try {
        const prefsRes = await fetch(`${API_BASE_URL}/v1/preferences/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_ids: participantIds }),
        });

        if (!prefsRes.ok) {
          throw new Error(`status ${prefsRes.status}: ${await prefsRes.text()}`);
        }

        const prefsJson = await prefsRes.json();
        const prefs = prefsJson?.preferences || [];
        (prefs || []).forEach((p: any) => {
          const vec = p.preference_vector;
          if (vec && Array.isArray(vec) && vec.length > 0) {
            prefById[String(p.user_id)] = vec;
          }
        });
      } catch (err) {
        console.warn('[Blend] backend prefs batch failed, falling back to Supabase client', err);
        const { data: prefs, error: prefsError } = await supabase
          .from('user_preferences')
          .select('user_id, preference_vector')
          .in('user_id', participantIds);

        if (prefsError) {
          console.error('[Blend] Supabase client prefs error:', prefsError);
          Alert.alert('Error', 'Failed to load user preferences. Please try again.');
          setBlendLoading(false);
          return;
        }

        (prefs || []).forEach((p: any) => {
          const vec = p.preference_vector;
          if (vec && Array.isArray(vec) && vec.length > 0) {
            prefById[String(p.user_id)] = vec;
          }
        });
      }

      // Check for missing preferences
      const missingPrefs = participantIds.filter(pid => {
        const vec = prefById[String(pid)];
        return !vec || !Array.isArray(vec) || vec.length === 0;
      });
      if (missingPrefs.length > 0) {
        const missingUsers = missingPrefs.map(pid => {
          if (pid === String(user.id)) return 'You';
          const u = selectedUsers.find(s => String(s.id) === pid);
          return u?.display_name || 'Unknown user';
        }).join(', ');
        
        Alert.alert(
          'Missing Preferences',
          `${missingUsers} ${missingPrefs.length === 1 ? 'hasn\'t' : 'haven\'t'} rated enough movies yet to generate a preference profile. They need to rate at least a few movies first!`,
          [{ text: 'OK' }]
        );
        setBlendLoading(false);
        return;
      }

      // Call backend to get blend recommendations
      const blendRes = await fetch(`${API_BASE_URL}/v1/blend/recommendations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          preference_vectors: prefById,
          max_movies: 600 
        }),
      });

      if (!blendRes.ok) {
        const txt = await blendRes.text();
        console.error('[Blend] recommendations endpoint failed', txt);
        Alert.alert('Error', 'Failed to compute blend recommendations. Please try again.');
        setBlendLoading(false);
        return;
      }

      const blendJson = await blendRes.json();
      const topPicks = blendJson?.top_picks || [];
      const categories = blendJson?.categories || {};

      setBlendedTopPicks(topPicks);
      setBlendedCategories(categories);
      setViewMode('results');
    } catch (e) {
      console.error('Error computing blended movies', e);
      setBlendedTopPicks([]);
      setBlendedCategories({});
    } finally {
      setBlendLoading(false);
    }
  };

  const renderRailCard = (movie: any) => {
    const title: string = movie.title || '';
    const releaseDate: string | null = movie.release_date || null;
    const year = releaseDate ? releaseDate.slice(0, 4) : '';
    const posterPath: string | null = movie.poster_path || null;
    const similarity: number | null =
      typeof movie.blend_score === 'number' ? movie.blend_score : null;

    const matchPercent =
      similarity !== null ? Math.round(Math.max(0, Math.min(1, similarity)) * 100) : null;

    const posterUrl = posterPath
      ? `https://image.tmdb.org/t/p/w500${posterPath}`
      : 'https://via.placeholder.com/300x450.png?text=No+Image';

    return (
      <Pressable
        key={movie.id}
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

  const renderUserItem = ({ item }: { item: any }) => {
    const name = item.display_name || 'Unnamed user';
    const email = item.email || '';

    const watchlistCount = Array.isArray(item.watchlist_movie_ids)
      ? item.watchlist_movie_ids.length
      : 0;

    const subtitle =
      watchlistCount > 0
        ? `${watchlistCount} in watchlist · Tap to view`
        : 'Tap to view profile';

    let avatarUri: string | undefined;
    if (item.avatar_url) {
      if (typeof item.avatar_url === 'string' && item.avatar_url.startsWith('http')) {
        avatarUri = item.avatar_url;
      } else if (supabase && typeof item.avatar_url === 'string') {
        try {
          const { data } = supabase.storage
            .from('avatars')
            .getPublicUrl(item.avatar_url);
          if (data?.publicUrl) {
            avatarUri = data.publicUrl;
          }
        } catch (e) {
          console.warn('Error building avatar URL for user row', e);
        }
      }
    }

    if (!avatarUri) {
      avatarUri =
        'https://api.dicebear.com/8.x/thumbs/svg?seed=' +
        encodeURIComponent(name || 'user');
    }

    return (
      <View style={styles.userRow}>
        <Pressable
          style={styles.userContentPressable}
          onPress={() => handlePressUser(item.id)}
        >
          <Image source={{ uri: avatarUri }} style={styles.userAvatarImage} />
          <View style={styles.userMeta}>
            <ThemedText type="defaultSemiBold" style={styles.userName}>
              {name}
            </ThemedText>
            {email ? (
              <ThemedText type="default" style={styles.userEmail}>
                {email}
              </ThemedText>
            ) : null}
            <ThemedText type="default" style={styles.userSub}>
              {subtitle}
            </ThemedText>
          </View>
        </Pressable>

        <LinearGradient
          colors={['#ff4ac7', '#ff2db0']}
          start={[0, 0]}
          end={[1, 1]}
          style={styles.startBlendButton}
        >
          <Pressable onPress={() => handleStartBlend(item)} style={styles.startBlendPressable}>
            <ThemedText style={styles.startBlendButtonText}>Start a blend</ThemedText>
          </Pressable>
        </LinearGradient>
      </View>
    );
  };

  return (
    <ThemedView style={styles.screen}>
      {viewMode === 'search' && (
        <View style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <View style={styles.header}>
              <ThemedText type="title" style={styles.title}>
                Blend
              </ThemedText>
              <ThemedText type="default" style={styles.subtitle}>
                Mix your vibe with friends and discover movies you&apos;ll all love.
              </ThemedText>
            </View>

            {/* Search bar */}
            <View style={styles.searchContainer}>
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={handleSearch}
                placeholder="Search users"
                placeholderTextColor="rgba(228, 206, 255, 0.45)"
                style={styles.searchInput}
                returnKeyType="search"
              />
            </View>

            {/* Following list */}
            {followingLoading && !searching && (
              <View style={styles.searchStatusRow}>
                <ActivityIndicator size="small" />
                <ThemedText type="default" style={styles.searchStatusText}>
                  Loading following...
                </ThemedText>
              </View>
            )}

            {!followingLoading && followingList.length > 0 && (
              <View style={styles.followingWrapper}>
                <ThemedText type="subtitle" style={styles.sectionTitle}>
                  Following
                </ThemedText>
                <FlatList
                  data={followingList}
                  keyExtractor={(item) => item.id}
                  renderItem={renderUserItem}
                  scrollEnabled={false}
                />
              </View>
            )}

            {/* Selected users (chips) */}
            {selectedUsers.length > 0 && (
              <View style={styles.selectedRow}>
                <View style={styles.selectedList}>
                  {selectedUsers.map((s) => (
                    <View key={s.id} style={styles.chip}>
                      <Image 
                        source={{ uri: s.avatar_url || `https://api.dicebear.com/8.x/thumbs/svg?seed=${encodeURIComponent(s.display_name || 'user')}` }} 
                        style={styles.chipAvatar} 
                      />
                      <ThemedText type="default" style={styles.chipText} numberOfLines={1}>
                        {s.display_name || 'User'}
                      </ThemedText>
                    </View>
                  ))}
                </View>

                <View style={styles.selectionActions}>
                  <Pressable style={styles.clearButton} onPress={clearSelection}>
                    <ThemedText type="default" style={styles.clearButtonText}>
                      Clear
                    </ThemedText>
                  </Pressable>
                  <LinearGradient colors={['#ff4ac7', '#ff2db0']} start={[0, 0]} end={[1, 1]} style={styles.computeButton}>
                    <Pressable onPress={computeBlended} style={styles.computePressable}>
                      {blendLoading ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <ThemedText style={styles.computeButtonText}>Compute blend</ThemedText>
                      )}
                    </Pressable>
                  </LinearGradient>
                </View>
              </View>
            )}

            {/* Search feedback */}
            {searching && (
              <View style={styles.searchStatusRow}>
                <ActivityIndicator size="small" />
                <ThemedText type="default" style={styles.searchStatusText}>
                  Searching users...
                </ThemedText>
              </View>
            )}

            {searchError && !searching && (
              <View style={styles.searchStatusRow}>
                <ThemedText type="default" style={styles.searchErrorText}>
                  {searchError}
                </ThemedText>
              </View>
            )}

            {/* Search results */}
            {filteredResults.length > 0 && (
              <View style={styles.searchResultsWrapper}>
                <ThemedText type="subtitle" style={styles.sectionTitle}>
                  Search results
                </ThemedText>
                <FlatList
                  data={filteredResults}
                  keyExtractor={(item) => item.id}
                  renderItem={renderUserItem}
                  scrollEnabled={false}
                />
              </View>
            )}
          </ScrollView>
        </View>
      )}

      {viewMode === 'results' && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.resultsContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.resultsHeader}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              {(() => {
                const selfName = (currentProfile as any)?.display_name
                  || (user as any)?.user_metadata?.full_name
                  || (user as any)?.email;
                const names = [selfName, ...selectedUsers.map((s: any) => s.display_name)].filter(Boolean);
                return `Blend with ${names.join(', ')}`;
              })()}
            </ThemedText>
            <View style={styles.resultsActions}>
              <Pressable style={styles.clearButton} onPress={() => setViewMode('search')}>
                <ThemedText type="default" style={styles.clearButtonText}>Adjust selection</ThemedText>
              </Pressable>
              <Pressable style={styles.clearButton} onPress={clearSelection}>
                <ThemedText type="default" style={styles.clearButtonText}>Clear</ThemedText>
              </Pressable>
            </View>
          </View>

          {blendLoading && (
            <View style={{ marginTop: 24, alignItems: 'center' }}>
              <ActivityIndicator />
              <ThemedText type="default" style={{ marginTop: 8, color: 'rgba(228, 206, 255, 0.85)' }}>Computing your blend...</ThemedText>
            </View>
          )}

          {!blendLoading && blendedTopPicks && blendedTopPicks.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <ThemedText type="title" style={styles.sectionTitle}>Top picks for you</ThemedText>
              </View>
              <FlatList
                data={blendedTopPicks}
                keyExtractor={(m: any) => String(m.id)}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.railListContent}
                scrollEnabled={true}
                renderItem={({ item }) => renderRailCard(item)}
              />
            </View>
          )}

          {!blendLoading && blendedCategories && Object.keys(blendedCategories).length > 0 && (
            <>
              {Object.entries(blendedCategories).map(([category, movies]: [string, any[]]) => (
                <View key={category} style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <ThemedText type="title" style={styles.sectionTitle}>
                      Best {category} Blend
                    </ThemedText>
                  </View>
                  <FlatList
                    data={movies}
                    keyExtractor={(m: any) => String(m.id)}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.railListContent}
                    scrollEnabled={true}
                    renderItem={({ item }) => renderRailCard(item)}
                  />
                </View>
              ))}
            </>
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
  const [showReview, setShowReview] = useState(false);
  const [rating, setRating] = useState<number>(0);
  const [reaction, setReaction] = useState<'like' | 'meh' | 'dislike' | null>(null);
  const [reviewText, setReviewText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    if (!movie || !user) return;

    const loadDetails = async () => {
      setLoading(true);
      try {
        const { data: movieData } = await supabase
          .from('movies')
          .select('*')
          .eq('id', movie.id)
          .maybeSingle();

        setMovieRow(movieData || movie);
      } finally {
        setLoading(false);
      }
    };

    loadDetails();
  }, [movie, user, supabase]);

  const handleSubmitReview = async () => {
    if (!user || !movieRow) return;
    setSubmitting(true);
    try {
      const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL;
      if (!API_BASE_URL) {
        Alert.alert('Error', 'API base URL not configured.');
        return;
      }

      const res = await fetch(`${API_BASE_URL}/v1/movies/${movieRow.id}/watch-and-react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          rating,
          reaction,
          review: reviewText,
        }),
      });

      if (!res.ok) {
        Alert.alert('Error', 'Failed to save your reaction.');
        return;
      }

      Alert.alert('Success', 'Your reaction has been saved!');
      setShowReview(false);
      setRating(0);
      setReaction(null);
      setReviewText('');
    } catch (e) {
      console.error('Error submitting review', e);
      Alert.alert('Error', 'Failed to save your reaction.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={true} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.modalContent} onPress={() => {}}>
          {loading ? (
            <ActivityIndicator />
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              <ThemedText type="defaultSemiBold" style={styles.modalTitle}>
                {movieRow?.title || movie?.title}
              </ThemedText>
              {movieRow?.poster_path && (
                <Image
                  source={{ uri: `https://image.tmdb.org/t/p/w500${movieRow.poster_path}` }}
                  style={styles.modalPoster}
                  contentFit="cover"
                />
              )}
              <Pressable
                style={styles.watchButton}
                onPress={() => setShowReview(!showReview)}
              >
                <ThemedText style={styles.watchButtonText}>Just Watched</ThemedText>
              </Pressable>

              {showReview && (
                <View style={styles.reviewContainer}>
                  <ThemedText style={styles.reviewLabel}>How was it?</ThemedText>
                  <View style={styles.ratingRow}>
                    {[1, 2, 3, 4, 5].map((r) => (
                      <Pressable
                        key={r}
                        onPress={() => setRating(r)}
                        style={[
                          styles.starButton,
                          rating >= r && styles.starButtonActive,
                        ]}
                      >
                        <ThemedText style={styles.star}>★</ThemedText>
                      </Pressable>
                    ))}
                  </View>

                  <View style={styles.reactionRow}>
                    {(['like', 'meh', 'dislike'] as const).map((reac) => (
                      <Pressable
                        key={reac}
                        onPress={() => setReaction(reac)}
                        style={[
                          styles.reactionButton,
                          reaction === reac && styles.reactionButtonActive,
                        ]}
                      >
                        <ThemedText style={styles.reactionText}>
                          {reac === 'like' ? '👍' : reac === 'meh' ? '😐' : '👎'}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </View>

                  <TextInput
                    placeholder="Add a review (optional)"
                    value={reviewText}
                    onChangeText={setReviewText}
                    multiline
                    style={styles.reviewInput}
                    placeholderTextColor="rgba(228, 206, 255, 0.5)"
                  />

                  <Pressable
                    style={styles.submitButton}
                    onPress={handleSubmitReview}
                    disabled={submitting}
                  >
                    <ThemedText style={styles.submitButtonText}>
                      {submitting ? 'Saving...' : 'Save'}
                    </ThemedText>
                  </Pressable>
                </View>
              )}

              <Pressable style={styles.closeButton} onPress={onClose}>
                <ThemedText style={styles.closeButtonText}>Close</ThemedText>
              </Pressable>
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#05010B',
  },
  content: {
    paddingTop: 72,
    paddingBottom: 32,
    paddingHorizontal: 20,
  },
  resultsContent: {
    paddingTop: 80,
    paddingBottom: 32,
    paddingHorizontal: 20,
  },
  header: {
    marginBottom: 15,
  },
  searchContainer: {
    marginBottom: 10,
  },
  searchInput: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(24, 9, 44, 0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.7)',
    color: '#FFFFFF',
    fontSize: 13,
  },
  searchStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  searchStatusText: {
    fontSize: 12,
    color: 'rgba(228, 206, 255, 0.8)',
  },
  searchErrorText: {
    fontSize: 12,
    color: '#FF6B81',
  },
  title: {
    fontSize: 26,
    letterSpacing: -0.03,
    color: '#FFFFFF',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(228, 206, 255, 0.85)',
  },
  searchResultsWrapper: {
    marginTop: 18,
    marginBottom: 4,
  },
  followingWrapper: {
    marginTop: 8,
    marginBottom: 12,
  },
  section: {
    marginTop: 18,
    paddingVertical: 14,
    borderRadius: 16,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(17, 4, 33, 0.95)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.45)',
  },
  sectionHeader: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 15,
    color: '#FFFFFF',
    marginBottom: 6,
  },
  sectionBody: {
    fontSize: 12,
    color: 'rgba(228, 206, 255, 0.85)',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(17, 4, 33, 0.95)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FFFFFF',
    marginBottom: 10,
    position: 'relative',
  },
  userAvatarImage: {
    width: 52,
    height: 52,
    borderRadius: 26,
    marginRight: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.9)',
  },
  userMeta: {
    flex: 1,
  },
  userContentPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 110,
  },
  userName: {
    fontSize: 13,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  userEmail: {
    fontSize: 11,
    color: '#FFFFFF',
    marginBottom: 1,
  },
  userSub: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  startBlendButton: {
    position: 'absolute',
    right: 20,
    top: '50%',
    transform: [{ translateY: -20 }],
    borderRadius: 999,
    overflow: 'hidden',
    minWidth: 96,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
    zIndex: 100,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  startBlendButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  startBlendPressable: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  selectedList: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  chipAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    marginRight: 8,
  },
  chipText: {
    fontSize: 12,
    maxWidth: 100,
    color: '#FFFFFF',
  },
  selectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 8,
  },
  clearButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  clearButtonText: {
    fontSize: 13,
    color: 'rgba(228,206,255,0.9)',
  },
  computeButton: {
    borderRadius: 999,
    overflow: 'hidden',
    minWidth: 110,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  computePressable: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  computeButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  resultsHeader: {
    marginBottom: 12,
    paddingHorizontal: 6,
  },
  resultsActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  railCard: {
    marginRight: 14,
    width: 120,
  },
  railPosterWrapper: {
    marginBottom: 8,
    borderRadius: 12,
    overflow: 'hidden',
  },
  railPoster: {
    width: 120,
    height: 180,
  },
  railCardBody: {
    flex: 1,
  },
  railCardTitle: {
    fontSize: 12,
    color: '#FFFFFF',
    marginBottom: 4,
  },
  railMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  railCardMeta: {
    fontSize: 10,
    color: 'rgba(228, 206, 255, 0.7)',
  },
  matchBadge: {
    backgroundColor: 'rgba(255, 74, 199, 0.2)',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 999,
  },
  matchBadgeText: {
    fontSize: 9,
    color: '#ff4ac7',
  },
  railListContent: {
    paddingRight: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    maxHeight: SCREEN_HEIGHT * 0.8,
    backgroundColor: '#180930',
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    color: '#FFFFFF',
    marginBottom: 12,
  },
  modalPoster: {
    width: '100%',
    height: 240,
    borderRadius: 12,
    marginBottom: 16,
  },
  watchButton: {
    backgroundColor: '#ff4ac7',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  watchButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  reviewContainer: {
    marginTop: 12,
  },
  reviewLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    marginBottom: 8,
    fontWeight: '600',
  },
  ratingRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  starButton: {
    padding: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
  },
  starButtonActive: {
    backgroundColor: '#ff4ac7',
  },
  star: {
    fontSize: 20,
    color: '#FFFFFF',
  },
  reactionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  reactionButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    flex: 1,
    alignItems: 'center',
  },
  reactionButtonActive: {
    backgroundColor: '#ff4ac7',
  },
  reactionText: {
    fontSize: 18,
  },
  reviewInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    color: '#FFFFFF',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    height: 80,
  },
  submitButton: {
    backgroundColor: '#ff4ac7',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  closeButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  closeButtonText: {
    color: 'rgba(228, 206, 255, 0.85)',
    fontSize: 14,
  },
});
