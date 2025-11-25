import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useAuth } from '@/providers/AuthProvider';
import { LoadingProvider, useLoading } from '@/providers/LoadingProvider';
import { GlobalLoader } from '@/components/GlobalLoader';

const { width, height } = Dimensions.get('window');
const vw = width / 100;
const vh = height / 100;
const AVATAR_SIZE = vw * 24; // 24% of viewport width

export default function ProfileSetupScreen() {
  const router = useRouter();
  const { user, supabase } = useAuth();
  const { showLoading, hideLoading } = useLoading();
  const [displayName, setDisplayName] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionResponse, requestPermission] = ImagePicker.useMediaLibraryPermissions();

  const handleBack = async () => {
    showLoading('Returning to login...');
    try {
      await supabase.auth.signOut();
      router.replace('/(auth)/login');
    } catch (e) {
      console.error('Error signing out on back:', e);
    } finally {
      hideLoading();
    }
  };

  const handlePickImage = async () => {
    try {
      if (!permissionResponse?.granted) {
        const perm = await requestPermission();
        if (!perm.granted) {
          setError('Permission to access photos is required to upload an avatar.');
          return;
        }
      }
  
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
  
      if (result.canceled) return;
      const asset = result.assets[0];
      setAvatarUri(asset.uri);
      setError(null);
    } catch (e) {
      console.error(e);
      setError('Something went wrong while picking the image.');
    }
  };

  const handleContinue = async () => {
    if (!user) return;
    if (!displayName.trim()) {
      setError('Please enter a display name.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    showLoading('Preparing your vibe...');

    try {
      let avatar_url: string | null = null;

      if (avatarUri) {
        const fileExt = avatarUri.split('.').pop() || 'jpg';
        const filePath = `${user.id}/${Date.now()}.${fileExt}`;

        const file = {
          uri: avatarUri,
          name: filePath.split('/').pop(),
          type: 'image/jpeg',
        } as any;

        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, file);

        if (uploadError) {
          console.error(uploadError);
          throw new Error('Failed to upload avatar.');
        }

        const { data: publicUrlData } = supabase.storage
          .from('avatars')
          .getPublicUrl(filePath);

        avatar_url = publicUrlData.publicUrl;
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          display_name: displayName.trim(),
          avatar_url,
        });

      if (profileError) {
        console.error(profileError);
        throw new Error('Failed to save profile.');
      }

      // On success, go to vibe quiz
      router.replace('/(vibe-quiz)/vibe-quiz');
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'Something went wrong saving your profile.');
    } finally {
      setIsSubmitting(false);
      hideLoading();
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#05010B' }}>
      <View style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Text style={styles.backButtonLabel}>{"<"} Back</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Create your profile</Text>
            <Text style={styles.subtitle}>
              Set your display name and profile picture. You can always change these later.
            </Text>
          </View>

          <View style={styles.avatarSection}>
            <TouchableOpacity style={styles.avatarWrapper} onPress={handlePickImage}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarPlaceholderText}>Add photo</Text>
                </View>
              )}
            </TouchableOpacity>
            <Text style={styles.avatarHint}>Tap to upload a profile picture</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Display name</Text>
            <TextInput
              placeholder="How should we show you?"
              placeholderTextColor="#777"
              value={displayName}
              onChangeText={setDisplayName}
              style={styles.input}
              autoCapitalize="words"
              autoCorrect={false}
            />
          </View>

          {error && (
            <Text style={styles.errorText}>
              {error}
            </Text>
          )}
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
      >
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.button, !displayName.trim() || isSubmitting ? styles.buttonDisabled : null]}
            onPress={handleContinue}
            disabled={!displayName.trim() || isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.buttonText}>Continue to vibe test</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 6 * vw,
    paddingTop: 8 * vh,
    paddingBottom: 4 * vh,
    backgroundColor: '#05010B',
  },
  header: {
    marginBottom: 3 * vh,
  },
  topBar: {
    marginBottom: 3 * vh,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  backButton: {
    paddingVertical: 0.8 * vh,
    paddingHorizontal: 2 * vw,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.5)',
    backgroundColor: 'rgba(24, 9, 44, 0.9)',
  },
  backButtonLabel: {
    fontSize: 14,
    color: 'rgba(228, 206, 255, 0.95)',
  },
  content: {
    flex: 1,
    justifyContent: 'flex-start',
  },
  title: {
    fontSize: 28,
    letterSpacing: -0.03,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(228, 206, 255, 0.85)',
    lineHeight: 22,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 3 * vh,
  },
  avatarWrapper: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(24, 9, 44, 0.95)',
  },
  avatarPlaceholderText: {
    color: '#888',
    fontSize: 13,
  },
  avatarHint: {
    color: 'rgba(228, 206, 255, 0.7)',
    fontSize: 12,
  },
  form: {
    marginBottom: 2 * vh,
  },
  label: {
    color: 'rgba(228, 206, 255, 0.9)',
    fontSize: 13,
    marginBottom: 8,
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(24, 9, 44, 0.95)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 160, 255, 0.7)',
    color: '#FFFFFF',
    fontSize: 16,
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 13,
    marginBottom: 18,
  },
  footer: {
    paddingHorizontal: 6 * vw,
    paddingBottom: 3 * vh,
    paddingTop: 1.5 * vh,
  },
  button: {
    backgroundColor: 'rgba(126, 52, 255, 1)',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 12,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 17,
  },
});