import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  TextInput,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { mockMovies } from '../mockData';

export default function HomeScreen() {
  const [movies, setMovies] = useState(() => [...mockMovies]);
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const [isAddModalVisible, setAddModalVisible] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newYear, setNewYear] = useState('');
  const [newRuntime, setNewRuntime] = useState('');
  const [newRating, setNewRating] = useState('');
  const [newPosterUrl, setNewPosterUrl] = useState('');

  const filteredMovies = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = movies.filter((movie) =>
      movie.title.toLowerCase().includes(query)
    );

    return filtered.slice().sort((a, b) => {
      const yearA = a.release_year ?? 0;
      const yearB = b.release_year ?? 0;
      return sortOrder === 'asc' ? yearA - yearB : yearB - yearA;
    });
  }, [search, sortOrder, movies]);

  const handleAddMovie = () => {
    const title = newTitle.trim();
    const posterUrl = newPosterUrl.trim();

    if (!title || !posterUrl) {
      Alert.alert(
        'Missing information',
        'Please enter at least a title and poster URL.'
      );
      return;
    }

    const yearNum = newYear ? parseInt(newYear, 10) : undefined;
    const runtimeNum = newRuntime ? parseInt(newRuntime, 10) : undefined;
    const nowIso = new Date().toISOString();

    const newMovie = {
      idx: movies.length,
      id: `local-${Date.now()}`,
      title,
      release_year: Number.isNaN(yearNum) ? undefined : yearNum,
      runtime_minutes: Number.isNaN(runtimeNum) ? undefined : runtimeNum,
      content_rating: newRating.trim() || 'NR',
      poster_url: posterUrl,
      synopsis: null,
      external_ids: {},
      created_at: nowIso,
      updated_at: nowIso,
    };

    setMovies((prev: any[]) => [newMovie, ...prev]);
    setNewTitle('');
    setNewYear('');
    setNewRuntime('');
    setNewRating('');
    setNewPosterUrl('');
    setAddModalVisible(false);
  };

  const toggleSortOrder = () => {
    setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  };

  return (
    <ThemedView style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <ThemedText type="title" style={styles.title}>
          Mock Movie Gallery
        </ThemedText>
        <ThemedText type="default" style={styles.subtitle}>
          Search our CineSync mock movie catalog by title.
        </ThemedText>
      </View>

      {/* Search + Sort */}
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
        <Pressable style={styles.sortToggle} onPress={toggleSortOrder}>
          <ThemedText type="defaultSemiBold" style={styles.sortToggleLabel}>
            {sortOrder === 'asc' ? 'Year ↑' : 'Year ↓'}
          </ThemedText>
        </Pressable>
      </View>

      {/* Movie Grid */}
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
                    <ThemedText
                      type="defaultSemiBold"
                      style={styles.badgeText}
                    >
                      {movie.content_rating ?? 'NR'}
                    </ThemedText>
                  </View>

                  <ThemedText type="default" style={styles.runtime}>
                    {movie.runtime_minutes
                      ? `${movie.runtime_minutes} min`
                      : '—'}
                  </ThemedText>
                </View>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Add Movie Button */}
      <View style={styles.addButtonContainer}>
        <Pressable
          style={styles.addButton}
          onPress={() => setAddModalVisible(true)}
        >
          <ThemedText type="defaultSemiBold" style={styles.addButtonLabel}>
            + Add Movie
          </ThemedText>
        </Pressable>
      </View>

      {/* Add Movie Modal */}
      <Modal
        visible={isAddModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAddModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>
              Add Movie
            </ThemedText>

            <ScrollView
              style={styles.modalForm}
              contentContainerStyle={styles.modalFormContent}
              keyboardShouldPersistTaps="handled"
            >
              <FormField
                label="Title"
                value={newTitle}
                onChangeText={setNewTitle}
                placeholder="Nice Guys"
              />
              <FormField
                label="Release Year"
                value={newYear}
                onChangeText={setNewYear}
                placeholder="2016"
                keyboardType="numeric"
              />
              <FormField
                label="Runtime (minutes)"
                value={newRuntime}
                onChangeText={setNewRuntime}
                placeholder="116"
                keyboardType="numeric"
              />
              <FormField
                label="Content Rating"
                value={newRating}
                onChangeText={setNewRating}
                placeholder="R, PG-13, etc."
              />
              <FormField
                label="Poster URL"
                value={newPosterUrl}
                onChangeText={setNewPosterUrl}
                placeholder="https://image.tmdb.org/t/p/original/..."
                autoCapitalize="none"
              />
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalButton, styles.modalButtonSecondary]}
                onPress={() => setAddModalVisible(false)}
              >
                <ThemedText
                  type="defaultSemiBold"
                  style={styles.modalButtonText}
                >
                  Cancel
                </ThemedText>
              </Pressable>

              <Pressable
                style={[styles.modalButton, styles.modalButtonPrimary]}
                onPress={handleAddMovie}
              >
                <ThemedText
                  type="defaultSemiBold"
                  style={styles.modalButtonText}
                >
                  Save
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ThemedView>
  );
}

// Small reusable component for inputs
const FormField = ({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
}: any) => (
  <>
    <ThemedText type="default" style={styles.modalLabel}>
      {label}
    </ThemedText>
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      keyboardType={keyboardType}
      placeholderTextColor="rgba(228, 206, 255, 0.6)"
      style={styles.modalInput}
      autoCapitalize={autoCapitalize}
    />
  </>
);

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
    marginRight: 10,
  },
  sortToggle: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(45, 14, 80, 0.95)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sortToggleLabel: {
    fontSize: 11,
    color: '#FDF7FF',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  card: {
    width: '47%',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(17, 4, 33, 0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.4)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 6,
    marginBottom: 16,
  },
  posterWrapper: {
    width: '100%',
    aspectRatio: 1 / 1.05,
    overflow: 'hidden',
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  cardBody: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginLeft: 4,
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '600',
    marginBottom: 3,
  },
  cardYear: {
    fontSize: 11,
    color: '#F4ECFF',
    marginBottom: 5,
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 200, 255, 0.8)',
    backgroundColor: 'rgba(58, 10, 85, 0.95)',
    marginRight: 6,
  },
  badgeText: {
    fontSize: 10,
    color: '#FFF8F8',
  },
  runtime: {
    fontSize: 11,
    color: '#F8F5FF',
  },
  addButtonContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 20,
    alignItems: 'center',
  },
  addButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(126, 52, 255, 1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
  addButtonLabel: {
    fontSize: 13,
    color: '#FFFFFF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    backgroundColor: '#0B0218',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.5)',
    paddingTop: 18,
    paddingBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 12,
  },
  modalTitle: {
    fontSize: 18,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalForm: {
    maxHeight: 260,
  },
  modalFormContent: {
    paddingHorizontal: 18,
    paddingBottom: 8,
  },
  modalLabel: {
    fontSize: 12,
    color: 'rgba(228, 206, 255, 0.9)',
    marginTop: 8,
    marginBottom: 4,
  },
  modalInput: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(24, 9, 44, 0.95)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.7)',
    color: '#FFFFFF',
    fontSize: 13,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 18,
    paddingTop: 8,
    gap: 8,
  },
  modalButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  modalButtonPrimary: {
    backgroundColor: 'rgba(126, 52, 255, 1)',
  },
  modalButtonSecondary: {
    backgroundColor: 'rgba(34, 16, 60, 0.95)',
  },
  modalButtonText: {
    fontSize: 12,
    color: '#FFFFFF',
  },
});

export {};
