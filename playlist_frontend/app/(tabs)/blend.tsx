import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  Alert,
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

  const [searchQuery, setSearchQuery] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<any[]>([]);
  const [selectedUsers, setSelectedUsers] = React.useState<any[]>([]);
  const [viewMode, setViewMode] = React.useState<'search' | 'results'>('search');
  const [blendedMovies, setBlendedMovies] = React.useState<any[] | null>(null);
  const [blendLoading, setBlendLoading] = React.useState(false);

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

    // Clear results when query is empty
    if (!trimmed) {
      setResults([]);
      setSearchError(null);
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
      return;
    }

    // Debounce the actual search call
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
  }, [searchQuery, supabase]);

  const handlePressUser = (otherUserId: string) => {
    // Navigate to a separate user profile route, e.g. /user/[id]
    router.push(`/user/${otherUserId}`);
  };

  const handleStartBlend = (otherUser: any) => {
    // Toggle selecting a user for the blend
    if (!otherUser || !otherUser.id) return;
    setSelectedUsers((prev) => {
      const exists = prev.find((p) => p.id === otherUser.id);
      if (exists) return prev.filter((p) => p.id !== otherUser.id);
      return [...prev, otherUser];
    });
  };

  const clearSelection = () => {
    setSelectedUsers([]);
    setBlendedMovies(null);
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
      // fetch all preference vectors via backend (service key) to avoid RLS
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
        console.log('[Blend] Loaded preferences (backend) for', Object.keys(prefById).length, 'participants:', Object.keys(prefById));
        console.log('[Blend] Participant IDs requested:', participantIds);
        console.log('[Blend] Raw prefs data (backend):', prefs);
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
        console.log('[Blend] Loaded preferences (client) for', Object.keys(prefById).length, 'participants:', Object.keys(prefById));
        console.log('[Blend] Raw prefs data (client):', prefs);
      }

      // Check for missing or invalid preferences
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

      // load movie vibes joined with movies
      const { data: movieVibes } = await supabase
        .from('movie_vibes')
        .select('movie_id, vibe_vector, movie:movies(*)')
        .limit(600);

      console.log('[Blend] Loaded', (movieVibes || []).length, 'movies with vibes');

      const vrows = (movieVibes || []).map((mv: any) => {
        const movie = mv.movie || {};
        const vibe = mv.vibe_vector || null;
        
        if (!vibe) {
          return { ...movie, similarity: 0 };
        }

        // compute avg cosine across participants
        const similarities: number[] = [];
        participantIds.forEach((pid) => {
          const vec = prefById[String(pid)] || null;
          if (vec && vibe) {
            // cosine
            const dot = vec.reduce((s: number, v: number, i: number) => s + (v || 0) * (vibe[i] || 0), 0);
            const normA = Math.sqrt(vec.reduce((s: number, v: number) => s + (v || 0) * (v || 0), 0));
            const normB = Math.sqrt(vibe.reduce((s: number, v: number) => s + (v || 0) * (v || 0), 0));
            const cos = normA === 0 || normB === 0 ? 0 : dot / (normA * normB);
            similarities.push(cos);
          }
        });

        const blended = similarities.length > 0 
          ? similarities.reduce((sum, s) => sum + s, 0) / similarities.length 
          : 0;

        return { ...movie, similarity: blended };
      });

      vrows.sort((a: any, b: any) => (b.similarity || 0) - (a.similarity || 0));
      
      console.log('[Blend] Top 5 blended movies:', vrows.slice(0, 5).map(m => ({ 
        title: m.title, 
        similarity: m.similarity 
      })));

      setBlendedMovies(vrows);
      setViewMode('results');
    } catch (e) {
      console.error('Error computing blended movies', e);
      setBlendedMovies([]);
    } finally {
      setBlendLoading(false);
    }
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

    // Build avatar URI from avatar_url, supporting both full URLs and storage paths
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
      // Soft, pretty fallback avatar
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
      <View style={styles.content}>
        {viewMode === 'search' && (
          <>
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

            {/* Selected users (chips) */}
            {selectedUsers.length > 0 && (
              <View style={styles.selectedRow}>
                <View style={styles.selectedList}>
                  {selectedUsers.map((s) => (
                    <View key={s.id} style={styles.chip}>
                      <Image source={{ uri: s.avatar_url || `https://api.dicebear.com/8.x/thumbs/svg?seed=${encodeURIComponent(s.display_name || 'user')}` }} style={styles.chipAvatar} />
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
                  <LinearGradient colors={[ '#ff4ac7', '#ff2db0' ]} start={[0,0]} end={[1,1]} style={styles.computeButton}>
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
            {results.length > 0 && (
              <View style={styles.searchResultsWrapper}>
                <ThemedText type="subtitle" style={styles.sectionTitle}>
                  Search results
                </ThemedText>
                <FlatList
                  data={results}
                  keyExtractor={(item) => item.id}
                  renderItem={renderUserItem}
                  scrollEnabled={false}
                />
              </View>
            )}
          </>
        )}

        {viewMode === 'results' && (
          <View>
            <View style={styles.resultsHeader}>
              <ThemedText type="subtitle" style={styles.sectionTitle}>
                Blend with { [((user as any)?.display_name || (user as any)?.email), ...selectedUsers.map((s: any) => s.display_name)].filter(Boolean).join(', ') }
              </ThemedText>
              <View style={styles.resultsActions}>
                <Pressable style={styles.clearButton} onPress={() => setViewMode('search') }>
                  <ThemedText type="default" style={styles.clearButtonText}>Adjust selection</ThemedText>
                </Pressable>
                <Pressable style={styles.clearButton} onPress={clearSelection}>
                  <ThemedText type="default" style={styles.clearButtonText}>Clear</ThemedText>
                </Pressable>
              </View>
            </View>

            {/* Blended movie list */}
            {blendLoading && (
              <View style={{ marginTop: 12 }}>
                <ActivityIndicator />
              </View>
            )}

            {!blendLoading && blendedMovies && blendedMovies.length === 0 && (
              <ThemedText type="default" style={styles.sectionBody}>No blended results available.</ThemedText>
            )}

            {!blendLoading && blendedMovies && blendedMovies.length > 0 && (
              <FlatList
                data={blendedMovies}
                keyExtractor={(m: any) => String(m.id || m.movie_id || m.title)}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.movieCard}
                    onPress={() => Alert.alert(item.title || item.name || 'Movie')}
                  >
                            {(() => {
                              const posterPath = item.poster_path || item.poster || item.image || null;
                              const posterUrl = posterPath
                                ? `https://image.tmdb.org/t/p/w500${posterPath}`
                                : 'https://via.placeholder.com/300x450.png?text=No+Image';
                              return <Image source={{ uri: posterUrl }} style={styles.moviePoster} contentFit="cover" />;
                            })()}
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <ThemedText type="defaultSemiBold" style={styles.movieTitle}>{item.title || item.name}</ThemedText>
                      <ThemedText type="default" style={styles.movieSim}>{Math.round(Math.max(0, Math.min(1, (item.similarity || 0))) * 100)}% match</ThemedText>
                    </View>
                  </Pressable>
                )}
              />
            )}
          </View>
        )}
      </View>
    </ThemedView>
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
  userHint: {
    marginTop: 6,
    fontSize: 11,
    color: 'rgba(228, 206, 255, 0.7)',
  },
  searchResultsWrapper: {
    marginTop: 18,
    marginBottom: 4,
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
  userDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    marginVertical: 4,
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
    // subtle shadow so it pops on dark background
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
    color: 'rgba(228,206,255,0.9)'
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
    marginTop: 6,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resultsActions: {
    flexDirection: 'row',
    gap: 8,
  },
  movieCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(17, 4, 33, 0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.08)',
    marginBottom: 10,
  },
  moviePoster: {
    width: 64,
    height: 96,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.03)'
  },
  movieTitle: {
    fontSize: 14,
    color: '#FFFFFF',
    marginBottom: 4,
  },
  movieSim: {
    fontSize: 12,
    color: 'rgba(228,206,255,0.75)'
  },
});
