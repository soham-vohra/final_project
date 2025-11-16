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

// Local type for user ratings (purely frontend for now)
type UserRating = {
  movieId: string;
  rating: number;
  review?: string;
};

export default function HomeScreen() {
  const [movies, setMovies] = useState(() => [...mockMovies]);
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // --- New: local ratings state ---------------------------------------------
  const [userRatings, setUserRatings] = useState<UserRating[]>([]);

  // --- New: Rank Movie modal state ------------------------------------------
  const [isRankModalVisible, setRankModalVisible] = useState(false);
  const [rankSearch, setRankSearch] = useState('');
  const [selectedMovieId, setSelectedMovieId] = useState<string | null>(null);
  const [selectedRating, setSelectedRating] = useState<number>(0);
  const [reviewText, setReviewText] = useState('');

  // Filter movies for the main gallery
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

  // Filter movies inside the Rank modal search
  const rankSearchResults = useMemo(() => {
    const query = rankSearch.trim().toLowerCase();
    if (!query) return movies.slice(0, 10); // show a few by default

    return movies.filter((movie) =>
      movie.title.toLowerCase().includes(query)
    );
  }, [rankSearch, movies]);

  const toggleSortOrder = () => {
    setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  };

  // Helper to find a rating for a movie
  const getRatingForMovie = (movieId: string): UserRating | undefined =>
    userRatings.find((r) => r.movieId === movieId);

  // Open Rank modal with optional pre-selected movie
  const openRankModal = (movieId?: string) => {
    setRankModalVisible(true);

    if (movieId) {
      const existing = getRatingForMovie(movieId);
      setSelectedMovieId(movieId);
      setSelectedRating(existing?.rating ?? 0);
      setReviewText(existing?.review ?? '');
      const movie = movies.find((m) => m.id === movieId);
      setRankSearch(movie?.title ?? '');
    } else {
      // fresh state
      setSelectedMovieId(null);
      setSelectedRating(0);
      setReviewText('');
      setRankSearch('');
    }
  };

  const closeRankModal = () => {
    setRankModalVisible(false);
  };

  // Save rating locally (no backend yet)
  const handleSaveRating = () => {
    if (!selectedMovieId) {
      Alert.alert('Pick a movie', 'Please select a movie to rank.');
      return;
    }
    if (!selectedRating || selectedRating < 1) {
      Alert.alert('Pick a rating', 'Please choose a rating from 1–5 stars.');
      return;
    }

    setUserRatings((prev) => {
      const existingIndex = prev.findIndex(
        (r) => r.movieId === selectedMovieId
      );
      const updated: UserRating = {
        movieId: selectedMovieId,
        rating: selectedRating,
        review: reviewText.trim() || undefined,
      };

      if (existingIndex === -1) {
        return [updated, ...prev];
      }

      const clone = [...prev];
      clone[existingIndex] = updated;
      return clone;
    });

    // TODO (future): call backend API to persist rating:
    // await fetch('/api/ratings', { method: 'POST', body: JSON.stringify({...}) });

    closeRankModal();
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
          {filteredMovies.map((movie) => {
            const userRating = getRatingForMovie(movie.id);

            return (
              <Pressable
                key={movie.id}
                style={styles.card}
                onPress={() => openRankModal(movie.id)}
              >
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

                  {/* New: show user rating if it exists */}
                  {userRating && (
                    <View style={styles.ratingRow}>
                      <ThemedText
                        type="defaultSemiBold"
                        style={styles.ratingStar}
                      >
                        ★
                      </ThemedText>
                      <ThemedText type="default" style={styles.ratingText}>
                        {userRating.rating}
                        {userRating.review ? ' · Tap to edit rating' : ''}
                      </ThemedText>
                    </View>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Rank Movie Button */}
      <View style={styles.addButtonContainer}>
        <Pressable style={styles.addButton} onPress={() => openRankModal()}>
          <ThemedText type="defaultSemiBold" style={styles.addButtonLabel}>
            ★ Rank Movie
          </ThemedText>
        </Pressable>
      </View>

      {/* Rank Movie Modal */}
      <Modal
        visible={isRankModalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeRankModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>
              Rank a Movie
            </ThemedText>

            <ScrollView
              style={styles.modalForm}
              contentContainerStyle={styles.modalFormContent}
              keyboardShouldPersistTaps="handled"
            >
              {/* 1. Search for a movie */}
              <ThemedText type="default" style={styles.modalLabel}>
                1. Search for a movie
              </ThemedText>
              <TextInput
                value={rankSearch}
                onChangeText={setRankSearch}
                placeholder="Start typing a title..."
                placeholderTextColor="rgba(228, 206, 255, 0.6)"
                style={styles.modalInput}
                autoCorrect={false}
                autoCapitalize="none"
              />

              <ScrollView
                style={styles.searchResultsList}
                nestedScrollEnabled
              >
                {rankSearchResults.map((movie) => {
                  const isSelected = movie.id === selectedMovieId;
                  return (
                    <Pressable
                      key={movie.id}
                      style={[
                        styles.searchResultItem,
                        isSelected && styles.searchResultItemSelected,
                      ]}
                      onPress={() => {
                        setSelectedMovieId(movie.id);
                        // prefill search input with exact title
                        setRankSearch(movie.title);
                        const existing = getRatingForMovie(movie.id);
                        setSelectedRating(existing?.rating ?? 0);
                        setReviewText(existing?.review ?? '');
                      }}
                    >
                      <Image
                        source={{ uri: movie.poster_url }}
                        style={styles.searchResultPoster}
                        contentFit="cover"
                      />
                      <View style={styles.searchResultTextContainer}>
                        <ThemedText
                          type="defaultSemiBold"
                          style={styles.searchResultTitle}
                          numberOfLines={1}
                        >
                          {movie.title}
                        </ThemedText>
                        <ThemedText
                          type="default"
                          style={styles.searchResultSubtitle}
                        >
                          {movie.release_year} · {movie.content_rating ?? 'NR'}
                        </ThemedText>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {/* 2. Rating */}
              <ThemedText type="default" style={styles.modalLabel}>
                2. Choose your rating
              </ThemedText>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Pressable
                    key={star}
                    style={styles.starButton}
                    onPress={() => setSelectedRating(star)}
                  >
                    <ThemedText
                      type="defaultSemiBold"
                      style={[
                        styles.starText,
                        selectedRating >= star && styles.starTextActive,
                      ]}
                    >
                      {selectedRating >= star ? '★' : '☆'}
                    </ThemedText>
                  </Pressable>
                ))}
                {selectedRating > 0 && (
                  <ThemedText type="default" style={styles.starValueText}>
                    {selectedRating}/5
                  </ThemedText>
                )}
              </View>

              {/* 3. Optional review */}
              <ThemedText type="default" style={styles.modalLabel}>
                3. Optional review
              </ThemedText>
              <TextInput
                value={reviewText}
                onChangeText={setReviewText}
                placeholder="What did you think? (optional)"
                placeholderTextColor="rgba(228, 206, 255, 0.6)"
                style={[styles.modalInput, styles.reviewInput]}
                multiline
              />
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalButton, styles.modalButtonSecondary]}
                onPress={closeRankModal}
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
                onPress={handleSaveRating}
              >
                <ThemedText
                  type="defaultSemiBold"
                  style={styles.modalButtonText}
                >
                  Save Rating
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  ratingStar: {
    fontSize: 13,
    color: '#FFD86B',
    marginRight: 4,
  },
  ratingText: {
    fontSize: 11,
    color: '#F8F5FF',
  },
  addButtonContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 20,
    alignItems: 'center',
    pointerEvents: 'box-none',
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
    maxHeight: 360,
  },
  modalFormContent: {
    paddingHorizontal: 18,
    paddingBottom: 8,
  },
  modalLabel: {
    fontSize: 12,
    color: 'rgba(228, 206, 255, 0.9)',
    marginTop: 10,
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
  reviewInput: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  searchResultsList: {
    maxHeight: 160,
    marginTop: 6,
    marginBottom: 4,
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 10,
    marginBottom: 4,
  },
  searchResultItemSelected: {
    backgroundColor: 'rgba(126, 52, 255, 0.25)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.8)',
  },
  searchResultPoster: {
    width: 32,
    height: 48,
    borderRadius: 6,
    marginRight: 8,
  },
  searchResultTextContainer: {
    flex: 1,
  },
  searchResultTitle: {
    fontSize: 13,
    color: '#FFFFFF',
  },
  searchResultSubtitle: {
    fontSize: 11,
    color: 'rgba(228, 206, 255, 0.8)',
  },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 4,
  },
  starButton: {
    marginRight: 4,
  },
  starText: {
    fontSize: 22,
    color: 'rgba(228, 206, 255, 0.7)',
  },
  starTextActive: {
    color: '#FFD86B',
  },
  starValueText: {
    marginLeft: 8,
    fontSize: 12,
    color: '#F8F5FF',
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
