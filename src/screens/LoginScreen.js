import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Colors } from '../constants/colors';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';

const LOGO = require('../../assets/EODE-logo.png');

export default function LoginScreen() {
  const [role, setRole] = useState('attendant');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Clear all fields every time this screen is focused (including after sign-out)
  useFocusEffect(
    useCallback(() => {
      setEmail('');
      setPassword('');
      setError('');
      setShowPassword(false);
    }, []),
  );

  const handleLogin = async () => {
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      // Step 1: Authenticate with Supabase
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });

      if (authError) {
        const msg = authError.message.toLowerCase();
        if (msg.includes('invalid login credentials')) {
          setError('Incorrect email or password. Please try again.');
        } else if (msg.includes('email not confirmed')) {
          setError('Please verify your email address before signing in.');
        } else if (msg.includes('too many requests')) {
          setError('Too many attempts. Please wait a moment and try again.');
        } else {
          setError(authError.message);
        }
        return;
      }

      // Step 2: Fetch the user's profile to confirm their actual role
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, email, full_name, role')
        .eq('id', authData.user.id)
        .single();

      if (profileError || !profile) {
        await supabase.auth.signOut();
        setError('Account setup is incomplete. Please contact your administrator.');
        return;
      }

      // Step 3: Guard — toggle selection must match the role stored on the profile.
      // Sign out immediately so no session lingers on mismatch.
      if (profile.role !== role) {
        await supabase.auth.signOut();
        setError(
          profile.role === 'admin'
            ? 'This account has Admin access. Please select the Admin role to continue.'
            : 'This account has Attendant access. Please select the Attendant role to continue.',
        );
        return;
      }

      // Step 4: AuthContext listens to supabase.auth.onAuthStateChange — it will
      // pick up the session automatically and trigger navigation. Nothing to do here.

    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const isAdmin = role === 'admin';

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* Navy header */}
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <View style={styles.header}>
          <Image source={LOGO} style={styles.logo} resizeMode="contain" />
          <Text style={styles.headerSub}>Ebenezer-Online Digital Enterprise</Text>
        </View>
      </SafeAreaView>

      {/* Form area */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign In</Text>
            <Text style={styles.cardSub}>Select your role to continue</Text>

            {/* Role toggle */}
            <View style={styles.roleToggle}>
              <TouchableOpacity
                style={[styles.roleBtn, !isAdmin && styles.roleBtnActive]}
                onPress={() => { setRole('attendant'); setError(''); }}
                activeOpacity={0.85}
              >
                <Ionicons
                  name="person-outline"
                  size={14}
                  color={!isAdmin ? Colors.white : Colors.secondaryText}
                  style={styles.roleIcon}
                />
                <Text style={[styles.roleBtnText, !isAdmin && styles.roleBtnTextActive]}>
                  Attendant
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.roleBtn, isAdmin && styles.roleBtnActiveAdmin]}
                onPress={() => { setRole('admin'); setError(''); }}
                activeOpacity={0.85}
              >
                <Ionicons
                  name="shield-checkmark-outline"
                  size={14}
                  color={isAdmin ? Colors.navy : Colors.secondaryText}
                  style={styles.roleIcon}
                />
                <Text style={[styles.roleBtnText, isAdmin && styles.roleBtnTextActiveAdmin]}>
                  Admin
                </Text>
              </TouchableOpacity>
            </View>

            {/* Email input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email Address</Text>
              <View style={styles.inputWrapper}>
                <Ionicons
                  name="mail-outline"
                  size={17}
                  color={Colors.secondaryText}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="you@example.com"
                  placeholderTextColor={Colors.secondaryText}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={email}
                  onChangeText={v => { setEmail(v); setError(''); }}
                  returnKeyType="next"
                />
              </View>
            </View>

            {/* Password input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputWrapper}>
                <Ionicons
                  name="lock-closed-outline"
                  size={17}
                  color={Colors.secondaryText}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={[styles.input, styles.inputFlex]}
                  placeholder="Enter your password"
                  placeholderTextColor={Colors.secondaryText}
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={v => { setPassword(v); setError(''); }}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(v => !v)}
                  style={styles.eyeBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name={showPassword ? 'eye-outline' : 'eye-off-outline'}
                    size={17}
                    color={Colors.secondaryText}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Error */}
            {!!error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={14} color="#C0392B" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Sign in button */}
            <TouchableOpacity
              style={[
                styles.signInBtn,
                isAdmin && styles.signInBtnAdmin,
                loading && styles.signInBtnDisabled,
              ]}
              onPress={handleLogin}
              activeOpacity={0.88}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={isAdmin ? Colors.navy : Colors.white} size="small" />
              ) : (
                <Text style={[styles.signInBtnText, isAdmin && styles.signInBtnTextAdmin]}>
                  Sign In as {isAdmin ? 'Admin' : 'Attendant'}
                </Text>
              )}
            </TouchableOpacity>

            {/* Forgot password */}
            <TouchableOpacity style={styles.forgotBtn} activeOpacity={0.7}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>

          </View>

          <Text style={styles.footer}>EODE POS • Secure Access</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  flex: {
    flex: 1,
  },
  headerSafe: {
    backgroundColor: Colors.navy,
  },
  header: {
    backgroundColor: Colors.navy,
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 32,
    alignItems: 'center',
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: 8,
  },
  headerSub: {
    fontSize: 13,
    color: Colors.secondaryText,
    letterSpacing: 0.5,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  card: {
    marginTop: 20,
    marginHorizontal: 16,
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 28,
    shadowColor: '#1B2A6B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 6,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.navy,
    marginBottom: 4,
  },
  cardSub: {
    fontSize: 13,
    color: Colors.secondaryText,
    marginBottom: 24,
  },

  /* Role toggle */
  roleToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.inputBackground,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    padding: 4,
    marginBottom: 24,
  },
  roleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 9,
  },
  roleBtnActive: {
    backgroundColor: Colors.navy,
  },
  roleBtnActiveAdmin: {
    backgroundColor: Colors.gold,
  },
  roleIcon: {
    marginRight: 6,
  },
  roleBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.secondaryText,
  },
  roleBtnTextActive: {
    color: Colors.white,
  },
  roleBtnTextActiveAdmin: {
    color: Colors.navy,
  },

  /* Inputs */
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.navy,
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBackground,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    height: 50,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: Colors.navy,
  },
  inputFlex: {
    flex: 1,
  },
  eyeBtn: {
    paddingLeft: 10,
  },

  /* Error */
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF0F0',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FCCACA',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    color: '#C0392B',
    flex: 1,
  },

  /* Sign in button */
  signInBtn: {
    backgroundColor: Colors.navy,
    borderRadius: 13,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  signInBtnAdmin: {
    backgroundColor: Colors.gold,
    shadowColor: Colors.gold,
  },
  signInBtnDisabled: {
    opacity: 0.65,
  },
  signInBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.white,
    letterSpacing: 0.3,
  },
  signInBtnTextAdmin: {
    color: Colors.navy,
  },

  /* Forgot */
  forgotBtn: {
    alignItems: 'center',
    marginTop: 18,
  },
  forgotText: {
    fontSize: 13,
    color: Colors.secondaryText,
    fontWeight: '500',
  },

  footer: {
    textAlign: 'center',
    marginTop: 28,
    fontSize: 12,
    color: Colors.secondaryText,
    letterSpacing: 0.5,
  },

});
