import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/providers/AuthProvider';
import { useLoading } from '@/providers/LoadingProvider';

const { width, height } = Dimensions.get('window');
const vw = width / 100;
const vh = height / 100;

type Choice = 'A' | 'B';

type VibeQuestion = {
  id: string;
  axisIndex: number;
  title: string;
  optionA: string;
  optionB: string;
};

const QUESTIONS: VibeQuestion[] = [
  {
    id: 'mainstream_vs_arthouse',
    axisIndex: 0,
    title: 'Friday night energy?',
    optionA: 'Big studio release everyone is talking about',
    optionB: 'Weird little festival film nobody has heard of',
  },
  {
    id: 'light_vs_dark',
    axisIndex: 1,
    title: 'Tonight’s vibe?',
    optionA: 'Light, fun, easy to watch',
    optionB: 'Heavy, emotional, intense',
  },
  {
    id: 'fast_vs_slow',
    axisIndex: 2,
    title: 'How do you like pacing?',
    optionA: 'Fast, punchy, always moving',
    optionB: 'Slow-burn, simmer and build',
  },
  {
    id: 'plot_vs_character',
    axisIndex: 3,
    title: 'What matters more?',
    optionA: 'Plot twists and story mechanics',
    optionB: 'Characters and their inner lives',
  },
  {
    id: 'action_vs_dialogue',
    axisIndex: 4,
    title: 'If you had to pick one?',
    optionA: 'Action, spectacle, big set pieces',
    optionB: 'Dialogue, conversations, subtext',
  },
  {
    id: 'old_vs_new',
    axisIndex: 5,
    title: 'What do you usually watch?',
    optionA: 'Older stuff, classics, pre-2000',
    optionB: 'Mostly recent releases',
  },
  {
    id: 'real_vs_fantastical',
    axisIndex: 6,
    title: 'Worlds you like being in?',
    optionA: 'Grounded, realistic stories',
    optionB: 'Sci‑fi, fantasy, surreal worlds',
  },
  {
    id: 'optimistic_vs_bleak',
    axisIndex: 7,
    title: 'Endings you lean toward?',
    optionA: 'Hopeful, uplifting, some kind of win',
    optionB: 'Bleak, ambiguous, might wreck me',
  },
  {
    id: 'short_vs_epic',
    axisIndex: 8,
    title: 'Runtime preference?',
    optionA: 'Tight 90–110 minute movies',
    optionB: 'Epic 2.5–3 hour sagas',
  },
  {
    id: 'comfort_vs_challenging',
    axisIndex: 9,
    title: 'Default when you can’t decide?',
    optionA: 'Comfort rewatch, cozy background',
    optionB: 'New, weird, challenging watch',
  },
];

export default function VibeQuizScreen() {
  const router = useRouter();
  const { supabase } = useAuth();
  const { showLoading, hideLoading } = useLoading();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Choice>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const totalQuestions = QUESTIONS.length;
  const currentQuestion = QUESTIONS[currentIndex];

  const progressLabel = useMemo(
    () => `Question ${currentIndex + 1} of ${totalQuestions}`,
    [currentIndex, totalQuestions]
  );

  const handleSelect = async (choice: Choice) => {
    if (!currentQuestion) return;

    setAnswers((prev) => ({
      ...prev,
      [currentQuestion.id]: choice,
    }));
    setError(null);

    const isLast = currentIndex === totalQuestions - 1;

    if (!isLast) {
      setCurrentIndex((idx) => Math.min(totalQuestions - 1, idx + 1));
      return;
    }

    // Last question -> submit
    await handleSubmit({ ...answers, [currentQuestion.id]: choice });
  };

  const buildPreferenceVector = (answerMap: Record<string, Choice>): number[] => {
    const vector: number[] = new Array(totalQuestions).fill(0);

    QUESTIONS.forEach((q) => {
      const ans = answerMap[q.id];
      if (ans === 'A') {
        vector[q.axisIndex] = -1.0;
      } else if (ans === 'B') {
        vector[q.axisIndex] = 1.0;
      } else {
        vector[q.axisIndex] = 0.0;
      }
    });

    return vector;
  };

  const handleSubmit = async (finalAnswers: Record<string, Choice>) => {
    try {
      setSubmitting(true);
      showLoading('Locking in your vibe...');

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) {
        console.error('No session found', sessionError);
        setError('We could not verify your session. Please try again.');
        return;
      }

      const session = sessionData.session;
      const userId = session.user.id;
      const token = session.access_token;
      const preferenceVector = buildPreferenceVector(finalAnswers);

      const payload = {
        user_id: userId,
        quizVersion: 'v1',
        answers: QUESTIONS.map((q) => ({
          questionId: q.id,
          choice: finalAnswers[q.id],
        })),
        preferenceVector,
      };

      const apiUrl = process.env.EXPO_PUBLIC_API_URL;
      if (!apiUrl) {
        console.warn('EXPO_PUBLIC_API_URL is not set. Skipping backend POST.');
      } else {
        const res = await fetch(`${apiUrl}/v1/preferences/quiz`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const txt = await res.text();
          console.error('Quiz submit failed', txt);
          setError('Something went wrong saving your preferences. Please try again.');
          return;
        }
      }

      // On success, go to main app tabs
      router.replace('/(tabs)');
    } catch (e: any) {
      console.error('Error submitting quiz', e);
      setError(e.message || 'Unexpected error. Please try again.');
    } finally {
      setSubmitting(false);
      hideLoading();
    }
  };

  const handleBackQuestion = () => {
    if (currentIndex === 0) {
      router.replace('/profile-setup');
      return;
    }
    setCurrentIndex((idx) => Math.max(0, idx - 1));
  };

  return (
    <View style={styles.screen}>
      {/* Top progress and back */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={handleBackQuestion} style={styles.backButton}>
          <Text style={styles.backButtonLabel}>
            {currentIndex === 0 ? '< Back' : '< Previous'}
          </Text>
        </TouchableOpacity>

        <View style={styles.progressWrapper}>
          <View style={styles.progressPill}>
            {QUESTIONS.map((q, index) => {
              const isActive = index === currentIndex;
              const isCompleted = index < currentIndex;
              return (
                <View
                  key={q.id}
                  style={[
                    styles.progressSegment,
                    (isActive || isCompleted) && styles.progressSegmentActive,
                    isActive && styles.progressSegmentCurrent,
                  ]}
                />
              );
            })}
          </View>
          <Text style={styles.progressLabel}>{progressLabel}</Text>
        </View>
      </View>

      {/* Question text */}
      <View style={styles.questionContainer}>
        <Text style={styles.questionTitle}>{currentQuestion.title}</Text>
      </View>

      {/* Choices */}
      <View style={styles.choicesRow}>
        <TouchableOpacity
          style={styles.choiceCard}
          activeOpacity={0.8}
          onPress={() => handleSelect('A')}
          disabled={submitting}
        >
          <Text style={styles.choiceLabel}>Option A</Text>
          <Text style={styles.choiceText}>{currentQuestion.optionA}</Text>
        </TouchableOpacity>

        <View style={styles.vsWrapper}>
          <Text style={styles.vsText}>vs.</Text>
        </View>

        <TouchableOpacity
          style={styles.choiceCard}
          activeOpacity={0.8}
          onPress={() => handleSelect('B')}
          disabled={submitting}
        >
          <Text style={styles.choiceLabel}>Option B</Text>
          <Text style={styles.choiceText}>{currentQuestion.optionB}</Text>
        </TouchableOpacity>
      </View>

      {/* Error & subtle footer */}
      <View style={styles.footer}>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {submitting && (
          <View style={styles.submittingRow}>
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={styles.submittingText}>Saving your vibe...</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#05010B',
    paddingTop: Platform.OS === 'ios' ? 6 * vh : 4 * vh,
    paddingBottom: 3 * vh,
    paddingHorizontal: 6 * vw,
    justifyContent: 'flex-start',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4 * vh,
  },
  backButton: {
    paddingVertical: 0.8 * vh,
    paddingHorizontal: 3 * vw,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.6)',
    backgroundColor: 'rgba(24, 9, 44, 0.9)',
  },
  backButtonLabel: {
    fontSize: 14,
    color: 'rgba(228, 206, 255, 0.95)',
  },
  progressWrapper: {
    flex: 1,
    marginLeft: 3 * vw,
    marginTop: 2 * vh
  },
  progressPill: {
    flexDirection: 'row',
    borderRadius: 999,
    backgroundColor: 'rgba(24, 9, 44, 0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.5)',
    paddingHorizontal: 1.5 * vw,
    paddingVertical: 0.7 * vh,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressSegment: {
    flex: 1,
    height: 0.8 * vh,
    marginHorizontal: 0.4 * vw,
    borderRadius: 999,
    backgroundColor: 'rgba(54, 22, 90, 0.8)',
  },
  progressSegmentActive: {
    backgroundColor: 'rgba(181, 120, 255, 0.9)',
  },
  progressSegmentCurrent: {
    shadowColor: '#FFDCFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
    elevation: 4,
  },
  progressLabel: {
    marginTop: 0.8 * vh,
    fontSize: 12,
    color: 'rgba(228, 206, 255, 0.9)',
  },
  questionContainer: {
    marginBottom: 4 * vh,
    justifyContent: 'center'
  },
  questionTitle: {
    fontSize: 22,
    color: '#FFFFFF',
    fontWeight: '700',
    marginTop: 8 * vh
  },
  choicesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2 * vh,
    marginBottom: 2 * vh,
  },
  choiceCard: {
    flex: 1,
    maxHeight: 28 * vh,
    minHeight: 20 * vh,
    borderRadius: 20,
    backgroundColor: 'rgba(17, 4, 33, 0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.55)',
    paddingHorizontal: 3 * vw,
    paddingVertical: 2.5 * vh,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.55,
    shadowRadius: 18,
    elevation: 10,
    justifyContent: 'center',
  },
  vsWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 2.2 * vw,
  },
  vsText: {
    fontSize: 18,
    fontWeight: '600',
    color: 'rgba(228, 206, 255, 0.95)',
  },
  choiceLabel: {
    fontSize: 13,
    color: 'rgba(228, 206, 255, 0.9)',
    marginBottom: 2 * vh,
  },
  choiceText: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  footer: {
    marginTop: 3 * vh,
    minHeight: 4 * vh,
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 13,
    marginBottom: 1 * vh,
  },
  submittingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 0.5 * vh,
  },
  submittingText: {
    marginLeft: 1 * vw,
    fontSize: 13,
    color: 'rgba(228, 206, 255, 0.9)',
  },
});