import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Colors } from '../../constants/colors';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminAccountScreen({ navigation }) {
  const { user, refreshUser } = useAuth();

  // ── Edit name state ────────────────────────────────────────────────────────
  const [name, setName]           = useState(user?.full_name ?? '');

  // Re-sync name input every time this screen comes into focus so it always
  // reflects the current saved value (avoids stale state after a name change).
  useFocusEffect(
    useCallback(() => {
      setName(user?.full_name ?? '');
      setNameError('');
      setNameSaved(false);
    }, [user?.full_name]),
  );
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState('');
  const [nameSaved, setNameSaved] = useState(false);

  // ── Change password state ──────────────────────────────────────────────────
  const [newPw, setNewPw]         = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showNew, setShowNew]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pwSaving, setPwSaving]   = useState(false);
  const [pwError, setPwError]     = useState('');
  const [pwSaved, setPwSaved]     = useState(false);

  // ── Save name ──────────────────────────────────────────────────────────────

  const handleSaveName = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Display name cannot be empty.');
      return;
    }
    if (trimmed === user?.full_name) {
      setNameError('That is already your current name.');
      return;
    }

    setNameSaving(true);
    setNameError('');
    setNameSaved(false);

    try {
      const { error: err } = await supabase
        .from('profiles')
        .update({ full_name: trimmed })
        .eq('id', user.id);

      if (err) throw err;

      // Sync AuthContext so the header/settings card reflects the new name
      await refreshUser();

      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 3000);
    } catch (err) {
      setNameError(err.message ?? 'Could not update name. Please try again.');
    } finally {
      setNameSaving(false);
    }
  }, [name, user, refreshUser]);

  // ── Change password ────────────────────────────────────────────────────────

  const handleChangePassword = useCallback(async () => {
    const pw  = newPw;
    const cpw = confirmPw;

    if (!pw)           { setPwError('New password cannot be empty.');            return; }
    if (pw.length < 6) { setPwError('Password must be at least 6 characters.'); return; }
    if (pw !== cpw)    { setPwError('Passwords do not match.');                  return; }

    setPwSaving(true);
    setPwError('');
    setPwSaved(false);

    try {
      const { error: err } = await supabase.auth.updateUser({ password: pw });
      if (err) throw err;

      setNewPw('');
      setConfirmPw('');
      setPwSaved(true);
      setTimeout(() => setPwSaved(false), 3000);
    } catch (err) {
      setPwError(err.message ?? 'Could not change password. Please try again.');
    } finally {
      setPwSaving(false);
    }
  }, [newPw, confirmPw]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color={Colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Admin Account</Text>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── Profile summary ── */}
          <View style={styles.profileCard}>
            <View style={styles.profileAvatar}>
              <Ionicons name="shield-checkmark" size={28} color={Colors.gold} />
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{user?.full_name ?? 'Admin'}</Text>
              <Text style={styles.profileEmail}>{user?.email ?? ''}</Text>
            </View>
          </View>

          {/* ════════════════════════════════════════
              Section 1 — Edit Display Name
          ════════════════════════════════════════ */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Display Name</Text>
            <Text style={styles.sectionNote}>
              Shown in the app header and on your profile card.
            </Text>

            <Text style={styles.fieldLabel}>Full Name</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="person-outline" size={17} color={Colors.secondaryText} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={v => { setName(v); setNameError(''); setNameSaved(false); }}
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={handleSaveName}
                placeholder="Your full name"
                placeholderTextColor={Colors.secondaryText}
              />
            </View>

            {!!nameError && (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle-outline" size={14} color="#C0392B" />
                <Text style={styles.errorText}>{nameError}</Text>
              </View>
            )}
            {nameSaved && (
              <View style={styles.successRow}>
                <Ionicons name="checkmark-circle-outline" size={14} color="#065F46" />
                <Text style={styles.successText}>Display name updated.</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.actionBtn, nameSaving && { opacity: 0.6 }]}
              onPress={handleSaveName}
              disabled={nameSaving}
              activeOpacity={0.85}
            >
              {nameSaving
                ? <ActivityIndicator size="small" color={Colors.navy} />
                : (
                  <>
                    <Ionicons name="checkmark-outline" size={17} color={Colors.navy} style={{ marginRight: 6 }} />
                    <Text style={styles.actionBtnText}>Save Name</Text>
                  </>
                )
              }
            </TouchableOpacity>
          </View>

          {/* ════════════════════════════════════════
              Section 2 — Change Password
          ════════════════════════════════════════ */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Change Password</Text>
            <Text style={styles.sectionNote}>
              Choose a strong password of at least 6 characters.
            </Text>

            {/* New password */}
            <Text style={styles.fieldLabel}>New Password</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="lock-closed-outline" size={17} color={Colors.secondaryText} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={newPw}
                onChangeText={v => { setNewPw(v); setPwError(''); setPwSaved(false); }}
                secureTextEntry={!showNew}
                placeholder="Min. 6 characters"
                placeholderTextColor={Colors.secondaryText}
                returnKeyType="next"
              />
              <TouchableOpacity onPress={() => setShowNew(v => !v)} style={styles.eyeBtn}>
                <Ionicons
                  name={showNew ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color={Colors.secondaryText}
                />
              </TouchableOpacity>
            </View>

            {/* Confirm password */}
            <Text style={styles.fieldLabel}>Confirm New Password</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="lock-closed-outline" size={17} color={Colors.secondaryText} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={confirmPw}
                onChangeText={v => { setConfirmPw(v); setPwError(''); setPwSaved(false); }}
                secureTextEntry={!showConfirm}
                placeholder="Re-enter new password"
                placeholderTextColor={Colors.secondaryText}
                returnKeyType="done"
                onSubmitEditing={handleChangePassword}
              />
              <TouchableOpacity onPress={() => setShowConfirm(v => !v)} style={styles.eyeBtn}>
                <Ionicons
                  name={showConfirm ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color={Colors.secondaryText}
                />
              </TouchableOpacity>
            </View>

            {!!pwError && (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle-outline" size={14} color="#C0392B" />
                <Text style={styles.errorText}>{pwError}</Text>
              </View>
            )}
            {pwSaved && (
              <View style={styles.successRow}>
                <Ionicons name="checkmark-circle-outline" size={14} color="#065F46" />
                <Text style={styles.successText}>Password changed successfully.</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.actionBtn, pwSaving && { opacity: 0.6 }]}
              onPress={handleChangePassword}
              disabled={pwSaving}
              activeOpacity={0.85}
            >
              {pwSaving
                ? <ActivityIndicator size="small" color={Colors.navy} />
                : (
                  <>
                    <Ionicons name="key-outline" size={17} color={Colors.navy} style={{ marginRight: 6 }} />
                    <Text style={styles.actionBtnText}>Change Password</Text>
                  </>
                )
              }
            </TouchableOpacity>
          </View>

          {/* Read-only email note */}
          <View style={styles.emailNote}>
            <Ionicons name="information-circle-outline" size={15} color={Colors.secondaryText} />
            <Text style={styles.emailNoteText}>
              Your login email ({user?.email}) cannot be changed here. Contact your system administrator if needed.
            </Text>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  header: {
    backgroundColor: Colors.navy,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn:     { width: 36, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: Colors.white, textAlign: 'center' },

  scroll: { padding: 20, paddingBottom: 48 },

  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 18,
    gap: 14,
    marginBottom: 24,
  },
  profileAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInfo:  { flex: 1 },
  profileName:  { fontSize: 16, fontWeight: '700', color: Colors.navy },
  profileEmail: { fontSize: 13, color: Colors.secondaryText, marginTop: 2 },

  section: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 20,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.navy,
    marginBottom: 4,
  },
  sectionNote: {
    fontSize: 12,
    color: Colors.secondaryText,
    marginBottom: 20,
    lineHeight: 18,
  },

  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.navy,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 7,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBackground,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    marginBottom: 16,
    height: 50,
  },
  inputIcon: { marginRight: 8 },
  input: {
    flex: 1,
    fontSize: 14,
    color: Colors.navy,
    paddingVertical: 0,
  },
  eyeBtn: { padding: 4 },

  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  errorText: { flex: 1, fontSize: 13, color: '#C0392B' },

  successRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#D1FAE5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#34D399',
  },
  successText: { flex: 1, fontSize: 13, color: '#065F46', fontWeight: '600' },

  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.gold,
    borderRadius: 12,
    height: 48,
    shadowColor: Colors.gold,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  actionBtnText: { fontSize: 14, fontWeight: '800', color: Colors.navy },

  emailNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.inputBackground,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emailNoteText: {
    flex: 1,
    fontSize: 12,
    color: Colors.secondaryText,
    lineHeight: 18,
  },
});
