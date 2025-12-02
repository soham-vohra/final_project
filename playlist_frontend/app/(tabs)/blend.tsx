import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/providers/AuthProvider';
import { useRouter } from 'expo-router';

export default function BlendScreen() {
  const { user, supabase } = useAuth();
  const router = useRouter();

  const [searchQuery, setSearchQuery] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<any[]>([]);

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
      <Pressable
        style={styles.userRow}
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
    );
  };

  return (
    <ThemedView style={styles.screen}>
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
      </ScrollView>
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
    borderColor: 'rgba(255, 160, 255, 0.45)',
    marginBottom: 10,
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
  userName: {
    fontSize: 13,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  userEmail: {
    fontSize: 11,
    color: 'rgba(228, 206, 255, 0.9)',
    marginBottom: 1,
  },
  userSub: {
    fontSize: 11,
    color: 'rgba(228, 206, 255, 0.75)',
  },
  userDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    marginVertical: 4,
  },
});
