import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image as RNImage,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useAuth } from '@/providers/AuthProvider';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

type MovieRow = any;

function dot(a: number[], b: number[]) {
  return a.reduce((s, v, i) => s + (v || 0) * (b[i] || 0), 0);
}

function norm(a: number[]) {
  return Math.sqrt(a.reduce((s, v) => s + (v || 0) * (v || 0), 0));
}

function cosine(a: number[] | null, b: number[] | null) {
  if (!a || !b) return 0;
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

export default function BlendWithUserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { supabase, user } = useAuth();
  const router = useRouter();

  const [otherProfile, setOtherProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [movies, setMovies] = useState<MovieRow[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<MovieRow | null>(null);

  useEffect(() => {
    if (!supabase || !id || !user) return;

    const load = async () => {
      setLoading(true);
      try {
        // load other profile
        const { data: profileData } = await supabase
          .from('profiles')
          .select('id, display_name, avatar_url')
          .eq('id', id)
          .maybeSingle();

        setOtherProfile(profileData || null);

        // load preference vectors
        const [{ data: pref1 }, { data: pref2 }] = await Promise.all([
          supabase.from('user_preferences').select('preference_vector').eq('user_id', user.id).maybeSingle(),
          supabase.from('user_preferences').select('preference_vector').eq('user_id', id).maybeSingle(),
        ]);

        const userPref = pref1?.preference_vector || null;
        const otherPref = pref2?.preference_vector || null;

        // load movies with vibe vectors joined
        const { data: movieVibes } = await supabase
          .from('movie_vibes')
          .select('movie_id, vibe_vector, movie:movies(*)')
          .limit(400);

        const rows = (movieVibes || []).map((mv: any) => {
          const movie = mv.movie || {};
          const vibe = mv.vibe_vector || null;
          const s1 = cosine(userPref, vibe);
          const s2 = cosine(otherPref, vibe);
          const blended = (s1 + s2) / 2;
          return { ...movie, similarity: blended };
        });

        // sort descending by similarity
        rows.sort((a: any, b: any) => (b.similarity || 0) - (a.similarity || 0));
        setMovies(rows);
      } catch (e) {
        console.error('Error loading blend recommendations', e);
        setMovies([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [supabase, id, user]);

  const renderItem = ({ item }: { item: any }) => {
    const posterUrl = item.poster_path
      ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
      : 'https://via.placeholder.com/300x450.png?text=No+Image';

    const matchPercent = typeof item.similarity === 'number'
      ? Math.round(Math.max(0, Math.min(1, item.similarity)) * 100)
      : null;

    return (
      <Pressable style={styles.card} onPress={() => setSelectedMovie(item)}>
        <Image source={{ uri: posterUrl }} style={styles.cardImage} />
        <View style={styles.cardBody}>
          <ThemedText type="defaultSemiBold" style={styles.cardTitle}>{item.title}</ThemedText>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <ThemedText type="default" style={styles.cardMeta}>{item.release_date?.slice(0,4) || ''}</ThemedText>
            {matchPercent !== null && (
              <View style={styles.matchPill}><ThemedText style={styles.matchPillText}>{matchPercent}%</ThemedText></View>
            )}
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <ThemedView style={styles.screen}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={styles.backButton}><Text style={{color:'#fff'}}>←</Text></Pressable>
        <ThemedText type="title" style={styles.headerTitle}>Blend with {otherProfile?.display_name || 'user'}</ThemedText>
      </View>

      {loading ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={movies}
          keyExtractor={(m: any) => String(m.id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16 }}
        />
      )}

      {selectedMovie && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setSelectedMovie(null)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContainer}>
              <Pressable style={styles.modalClose} onPress={() => setSelectedMovie(null)}>
                <Text style={{color:'#fff'}}>✕</Text>
              </Pressable>
              <ThemedText type="title" style={{ marginBottom: 8 }}>{selectedMovie.title}</ThemedText>
              <ThemedText type="default">Blended score: {Math.round(Math.max(0, Math.min(1, selectedMovie.similarity || 0)) * 100)}%</ThemedText>
            </View>
          </View>
        </Modal>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#05010B' },
  headerRow: { paddingTop: 72, paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center' },
  backButton: { paddingRight: 12 },
  headerTitle: { color: '#fff', fontSize: 20 },
  card: { flexDirection: 'row', backgroundColor: 'rgba(17,4,33,0.95)', borderRadius: 14, padding: 12, marginBottom: 12, alignItems: 'center' },
  cardImage: { width: 68, height: 100, borderRadius: 8, marginRight: 12 },
  cardBody: { flex: 1 },
  cardTitle: { color: '#fff', fontSize: 16, marginBottom: 6 },
  cardMeta: { color: 'rgba(228,206,255,0.8)' },
  matchPill: { backgroundColor: 'rgba(126,52,255,0.9)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  matchPillText: { color: '#fff' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  modalContainer: { width: '90%', backgroundColor: '#0B0218', borderRadius: 12, padding: 16 },
  modalClose: { position: 'absolute', top: 8, right: 8, padding: 6 },
});
