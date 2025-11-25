import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/providers/AuthProvider';

export default function SignupScreen() {
  const router = useRouter();
  const { signUp } = useAuth(); // later replace with real signUp logic

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  const handleSignup = async () => {
    try {
      setLoading(true);

      if (!email || !password) {
        Alert.alert('Missing fields', 'Please enter an email and password.');
        return;
      }

      await signUp(email, password);

      // On success, flip the UI into "check your email" mode.
      setConfirmationSent(true);
    } catch (error: any) {
      console.error('Signup error', error);
      Alert.alert('Signup error', error.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {!confirmationSent ? (
        <>
          <Text style={styles.title}>Create an Account</Text>

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor="#aaa"
            autoCapitalize="none"
            style={styles.input}
          />

          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor="#aaa"
            secureTextEntry
            style={styles.input}
          />

          <TouchableOpacity
            style={styles.button}
            disabled={loading}
            onPress={handleSignup}
          >
            <Text style={styles.buttonText}>{loading ? 'Creating...' : 'Sign Up'}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
            <Text style={styles.link}>Already have an account? Log in</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>
            We&apos;ve sent a confirmation link
            {email ? ` to ` : ' to your inbox.'}
            {email ? <Text style={styles.highlight}>{email.trim()}</Text> : null}
            {'. '}
            Please confirm your email address, then return here and log in to continue.
          </Text>

          <TouchableOpacity
            style={styles.button}
            onPress={() => router.replace('/(auth)/login')}
          >
            <Text style={styles.buttonText}>Back to login</Text>
          </TouchableOpacity>

          <Text style={styles.secondaryNote}>
            Didn&apos;t see it? Check your spam folder or try signing up again with the same email.
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05010B',
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  title: {
    color: 'white',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 32,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#1A0F29',
    padding: 14,
    borderRadius: 10,
    color: 'white',
    marginBottom: 16,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#AF52DE',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 18,
  },
  buttonText: {
    color: 'white',
    fontSize: 17,
    fontWeight: '600',
  },
  link: {
    color: '#D0A4FF',
    textAlign: 'center',
    fontSize: 15,
    marginTop: 4,
  },
  subtitle: {
    color: 'rgba(228, 206, 255, 0.9)',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 24,
  },
  highlight: {
    color: '#D0A4FF',
    fontWeight: '600',
  },
  secondaryNote: {
    marginTop: 12,
    color: 'rgba(228, 206, 255, 0.8)',
    fontSize: 13,
    textAlign: 'center',
  },
});