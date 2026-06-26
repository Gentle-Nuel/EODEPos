import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { createClient } from '@supabase/supabase-js';
import { Colors } from '../../constants/colors';
import { supabase } from '../../lib/supabase';

// ─── Secondary client (signUp without replacing admin session) ─────────────────

const SUPABASE_URL      = 'https://eqfjphvzeeugoycaobfc.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxZmpwaHZ6ZWV1Z295Y2FvYmZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NDE1NTEsImV4cCI6MjA5NjExNzU1MX0.WLfH0VdbZYnxwrvIYUAKGmHvuUf0xCF-MN09qLGwjso';

// No AsyncStorage → session stays in-memory, never overwrites the admin's
const tempClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-NG', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

const AVATAR_COLORS = [
  '#1B2A6B', '#C9952A', '#2980B9', '#16A085', '#8E44AD', '#C0392B',
];

function avatarColor(str) {
  let hash = 0;
  for (let i = 0; i < (str?.length ?? 0); i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ManageAttendantsScreen({ navigation }) {
  const [attendants, setAttendants]   = useState([]);
  const [salesMap, setSalesMap]       = useState({});
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState(null);

  // ── Actions sheet ──────────────────────────────────────────────────────────
  const [actionTarget, setActionTarget] = useState(null); // attendant object

  // ── Add attendant modal ────────────────────────────────────────────────────
  const [showAdd, setShowAdd]         = useState(false);
  const [addName, setAddName]         = useState('');
  const [addEmail, setAddEmail]       = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addShowPw, setAddShowPw]     = useState(false);
  const [addBusy, setAddBusy]         = useState(false);
  const [addError, setAddError]       = useState('');

  // ── Edit name modal ────────────────────────────────────────────────────────
  const [editTarget, setEditTarget]   = useState(null);
  const [editName, setEditName]       = useState('');
  const [editBusy, setEditBusy]       = useState(false);
  const [editError, setEditError]     = useState('');

  // ── Set password modal state ───────────────────────────────────────────────
  const [showSetPw, setShowSetPw]       = useState(false);
  const [setPwTarget, setSetPwTarget]   = useState(null);
  const [newPw, setNewPw]               = useState('');
  const [confirmPw, setConfirmPw]       = useState('');
  const [showNewPw, setShowNewPw]       = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [setPwBusy, setSetPwBusy]       = useState(false);
  const [setPwError, setSetPwError]     = useState('');

  // ── Remove busy state ──────────────────────────────────────────────────────
  const [removeBusy, setRemoveBusy]   = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, full_name, email, created_at')
        .eq('role', 'attendant')
        .order('full_name');

      if (pErr) throw pErr;

      const list = profiles ?? [];
      setAttendants(list);

      if (list.length > 0) {
        const ids = list.map(a => a.id);
        const { data: salesData, error: sErr } = await supabase
          .from('sales')
          .select('attendant_id')
          .in('attendant_id', ids);

        if (!sErr && salesData) {
          const counts = {};
          salesData.forEach(s => {
            counts[s.attendant_id] = (counts[s.attendant_id] ?? 0) + 1;
          });
          setSalesMap(counts);
        }
      } else {
        setSalesMap({});
      }
    } catch (err) {
      setError(err.message ?? 'Could not load attendants. Check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Actions sheet ──────────────────────────────────────────────────────────

  const openActions = useCallback((attendant) => {
    setActionTarget(attendant);
  }, []);

  const closeActions = useCallback(() => {
    if (removeBusy) return;
    setActionTarget(null);
  }, [removeBusy]);

  // ── Add attendant ──────────────────────────────────────────────────────────

  const openAdd = useCallback(() => {
    setAddName('');
    setAddEmail('');
    setAddPassword('');
    setAddShowPw(false);
    setAddError('');
    setShowAdd(true);
  }, []);

  const closeAdd = useCallback(() => {
    if (addBusy) return;
    setShowAdd(false);
  }, [addBusy]);

  const handleAdd = useCallback(async () => {
    const name  = addName.trim();
    const email = addEmail.trim().toLowerCase();
    const pw    = addPassword;

    if (!name)                return setAddError('Full name is required.');
    if (!email)               return setAddError('Email address is required.');
    if (!email.includes('@')) return setAddError('Enter a valid email address.');
    if (pw.length < 6)        return setAddError('Password must be at least 6 characters.');

    setAddBusy(true);
    setAddError('');

    try {
      // Create auth user via temp client — doesn't touch admin session
      const { data: signUpData, error: signUpErr } = await tempClient.auth.signUp({
        email,
        password: pw,
      });

      if (signUpErr) {
        setAddError(
          signUpErr.message?.toLowerCase().includes('already registered')
            ? 'An account with this email already exists.'
            : (signUpErr.message ?? 'Could not create account.'),
        );
        return;
      }

      const userId = signUpData?.user?.id;
      if (!userId) {
        setAddError('Account created but no user ID returned. Please try again.');
        return;
      }

      // Upsert profile row via admin client
      const { error: profileErr } = await supabase
        .from('profiles')
        .upsert(
          { id: userId, email, full_name: name, role: 'attendant' },
          { onConflict: 'id' },
        );

      if (profileErr) {
        setAddError('Account created but profile setup failed: ' + profileErr.message);
        return;
      }

      setShowAdd(false);
      fetchAll();
    } catch (err) {
      setAddError(err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setAddBusy(false);
    }
  }, [addName, addEmail, addPassword, fetchAll]);

  // ── Edit name ──────────────────────────────────────────────────────────────

  const openEdit = useCallback((attendant) => {
    setActionTarget(null);   // close actions sheet first
    // slight delay so the actions sheet closes before edit opens
    setTimeout(() => {
      setEditTarget(attendant);
      setEditName(attendant.full_name ?? '');
      setEditError('');
    }, 300);
  }, []);

  const closeEdit = useCallback(() => {
    if (editBusy) return;
    setEditTarget(null);
  }, [editBusy]);

  const handleEdit = useCallback(async () => {
    const name = editName.trim();
    if (!name) return setEditError('Name cannot be empty.');
    if (!editTarget) return;

    setEditBusy(true);
    setEditError('');

    try {
      const { error: err } = await supabase
        .from('profiles')
        .update({ full_name: name })
        .eq('id', editTarget.id);

      if (err) throw err;

      setAttendants(prev =>
        prev.map(a => a.id === editTarget.id ? { ...a, full_name: name } : a),
      );
      setEditTarget(null);
    } catch (err) {
      setEditError(err.message ?? 'Could not update name. Please try again.');
    } finally {
      setEditBusy(false);
    }
  }, [editTarget, editName]);

  // ── Set attendant password ─────────────────────────────────────────────────

  const openSetPassword = useCallback((attendant) => {
    setSetPwTarget(attendant);
    setNewPw('');
    setConfirmPw('');
    setShowNewPw(false);
    setShowConfirmPw(false);
    setSetPwError('');
    setActionTarget(null);   // close actions sheet
    setTimeout(() => setShowSetPw(true), 300); // wait for sheet to close
  }, []);

  const closeSetPassword = useCallback(() => {
    if (setPwBusy) return;
    setShowSetPw(false);
    setSetPwTarget(null);
  }, [setPwBusy]);

  const handleSetPassword = useCallback(async () => {
    const pw  = newPw;
    const cpw = confirmPw;

    if (!pw)           { setSetPwError('Password cannot be empty.');            return; }
    if (pw.length < 6) { setSetPwError('Password must be at least 6 characters.'); return; }
    if (pw !== cpw)    { setSetPwError('Passwords do not match.');               return; }
    if (!setPwTarget)  return;

    setSetPwBusy(true);
    setSetPwError('');

    try {
      const { error: err } = await supabase.functions.invoke('set-attendant-password', {
        body: { userId: setPwTarget.id, password: pw },
      });
      if (err) throw err;

      setShowSetPw(false);
      setSetPwTarget(null);
      Alert.alert('Password Updated', `Password for ${setPwTarget.full_name ?? setPwTarget.email} has been changed.`);
    } catch (err) {
      setSetPwError(err.message ?? 'Could not update password. Please try again.');
    } finally {
      setSetPwBusy(false);
    }
  }, [newPw, confirmPw, setPwTarget]);

  // ── Remove attendant ───────────────────────────────────────────────────────

  const handleRemove = useCallback(() => {
    if (!actionTarget) return;

    const name = actionTarget.full_name ?? actionTarget.email;

    const doRemove = async () => {
      setRemoveBusy(true);
      try {
        const { error: err } = await supabase.functions.invoke('delete-attendant', {
          body: { userId: actionTarget.id },
        });
        if (err) throw err;
        const removed = actionTarget;
        setActionTarget(null);
        setAttendants(prev => prev.filter(a => a.id !== removed.id));
      } catch (err) {
        Alert.alert('Error', err.message ?? 'Could not remove attendant. Please try again.');
      } finally {
        setRemoveBusy(false);
      }
    };

    if (Platform.OS === 'web') {
      // Alert.alert with buttons is silently blocked by Chrome Android in PWA mode
      if (window.confirm(`Remove ${name}?\n\nThey will no longer be able to log in.`)) {
        doRemove();
      }
    } else {
      Alert.alert(
        'Remove Attendant',
        `Remove ${name}?\n\nThey will no longer be able to log in. Their past sales records will be preserved.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: doRemove },
        ],
      );
    }
  }, [actionTarget]);

  // ── Render item ────────────────────────────────────────────────────────────

  const renderItem = useCallback(({ item: a }) => {
    const color      = avatarColor(a.full_name ?? a.email);
    const salesCount = salesMap[a.id] ?? 0;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => openActions(a)}
        activeOpacity={0.75}
      >
        <View style={[styles.avatar, { backgroundColor: color }]}>
          <Text style={styles.avatarText}>{initials(a.full_name)}</Text>
        </View>

        <View style={styles.cardInfo}>
          <Text style={styles.cardName} numberOfLines={1}>
            {a.full_name ?? 'Unnamed'}
          </Text>
          <Text style={styles.cardEmail} numberOfLines={1}>{a.email}</Text>
          <Text style={styles.cardMeta}>Joined {fmtDate(a.created_at)}</Text>
        </View>

        <View style={styles.salesBadge}>
          <Text style={styles.salesCount}>{salesCount}</Text>
          <Text style={styles.salesLabel}>{salesCount === 1 ? 'sale' : 'sales'}</Text>
        </View>

        <Ionicons name="chevron-forward" size={15} color={Colors.border} style={{ marginLeft: 4 }} />
      </TouchableOpacity>
    );
  }, [salesMap, openActions]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color={Colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Attendants</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={openAdd}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="person-add-outline" size={22} color={Colors.gold} />
        </TouchableOpacity>
      </View>

      {/* ── Body ── */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.navy} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={44} color="#C0392B" />
          <Text style={[styles.centeredText, { color: '#C0392B' }]}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchAll()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : attendants.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="people-outline" size={52} color={Colors.border} />
          <Text style={styles.centeredText}>No attendants yet</Text>
          <Text style={styles.centeredSub}>Tap the + icon to add one</Text>
        </View>
      ) : (
        <FlatList
          data={attendants}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchAll(true)}
              tintColor={Colors.navy}
              colors={[Colors.navy]}
            />
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Text style={styles.listNote}>Tap an attendant to manage their account.</Text>
          }
        />
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          Actions Sheet
      ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={!!actionTarget}
        transparent
        animationType="slide"
        onRequestClose={closeActions}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={closeActions}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={styles.modalCard}>

              {/* Attendant summary */}
              <View style={styles.sheetProfile}>
                <View style={[
                  styles.sheetAvatar,
                  { backgroundColor: avatarColor(actionTarget?.full_name ?? actionTarget?.email ?? '') },
                ]}>
                  <Text style={styles.sheetAvatarText}>
                    {initials(actionTarget?.full_name)}
                  </Text>
                </View>
                <View style={styles.sheetProfileInfo}>
                  <Text style={styles.sheetName} numberOfLines={1}>
                    {actionTarget?.full_name ?? 'Unnamed'}
                  </Text>
                  <Text style={styles.sheetEmail} numberOfLines={1}>
                    {actionTarget?.email}
                  </Text>
                </View>
              </View>

              <View style={styles.sheetDivider} />

              {/* Edit Name */}
              <TouchableOpacity
                style={styles.sheetAction}
                onPress={() => openEdit(actionTarget)}
                activeOpacity={0.75}
              >
                <View style={[styles.sheetActionIcon, { backgroundColor: Colors.inputBackground }]}>
                  <Ionicons name="create-outline" size={18} color={Colors.navy} />
                </View>
                <View style={styles.sheetActionText}>
                  <Text style={styles.sheetActionLabel}>Edit Display Name</Text>
                  <Text style={styles.sheetActionSub}>Update how their name appears</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.border} />
              </TouchableOpacity>

              {/* Set Password */}
              <TouchableOpacity
                style={styles.sheetAction}
                onPress={() => openSetPassword(actionTarget)}
                disabled={false}
                activeOpacity={0.75}
              >
                <View style={[styles.sheetActionIcon, { backgroundColor: '#EFF6FF' }]}>
                  <Ionicons name="key-outline" size={18} color="#2980B9" />
                </View>
                <View style={styles.sheetActionText}>
                  <Text style={styles.sheetActionLabel}>Set Password</Text>
                  <Text style={styles.sheetActionSub}>Directly assign a new password</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.border} />
              </TouchableOpacity>

              {/* Remove */}
              <TouchableOpacity
                style={[styles.sheetAction, { marginBottom: 0 }]}
                onPress={handleRemove}
                disabled={removeBusy}
                activeOpacity={0.75}
              >
                <View style={[styles.sheetActionIcon, { backgroundColor: '#FEE2E2' }]}>
                  {removeBusy
                    ? <ActivityIndicator size="small" color="#C0392B" />
                    : <Ionicons name="person-remove-outline" size={18} color="#C0392B" />
                  }
                </View>
                <View style={styles.sheetActionText}>
                  <Text style={[styles.sheetActionLabel, { color: '#C0392B' }]}>Remove Attendant</Text>
                  <Text style={styles.sheetActionSub}>Revokes login access immediately</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.border} />
              </TouchableOpacity>

              {/* Cancel */}
              <TouchableOpacity
                style={styles.sheetCancel}
                onPress={closeActions}
                disabled={removeBusy}
                activeOpacity={0.8}
              >
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </TouchableOpacity>

            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════
          Add Attendant Modal
      ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={showAdd}
        transparent
        animationType="slide"
        onRequestClose={closeAdd}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>

            <View style={styles.modalHeader}>
              <View style={[styles.modalIconWrap, { backgroundColor: Colors.inputBackground }]}>
                <Ionicons name="person-add-outline" size={22} color={Colors.navy} />
              </View>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>Add Attendant</Text>
                <Text style={styles.modalSub}>Create a new attendant account</Text>
              </View>
              <TouchableOpacity
                onPress={closeAdd}
                disabled={addBusy}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color={Colors.secondaryText} />
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Full Name</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="person-outline" size={17} color={Colors.secondaryText} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="e.g. John Doe"
                placeholderTextColor={Colors.secondaryText}
                value={addName}
                onChangeText={v => { setAddName(v); setAddError(''); }}
                autoCapitalize="words"
                returnKeyType="next"
              />
            </View>

            <Text style={styles.fieldLabel}>Email Address</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="mail-outline" size={17} color={Colors.secondaryText} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="attendant@example.com"
                placeholderTextColor={Colors.secondaryText}
                value={addEmail}
                onChangeText={v => { setAddEmail(v); setAddError(''); }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            <Text style={styles.fieldLabel}>Temporary Password</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="lock-closed-outline" size={17} color={Colors.secondaryText} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Min. 6 characters"
                placeholderTextColor={Colors.secondaryText}
                value={addPassword}
                onChangeText={v => { setAddPassword(v); setAddError(''); }}
                secureTextEntry={!addShowPw}
                returnKeyType="done"
                onSubmitEditing={handleAdd}
              />
              <TouchableOpacity onPress={() => setAddShowPw(v => !v)} style={styles.eyeBtn}>
                <Ionicons
                  name={addShowPw ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color={Colors.secondaryText}
                />
              </TouchableOpacity>
            </View>

            {!!addError && (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle-outline" size={14} color="#C0392B" />
                <Text style={styles.errorText}>{addError}</Text>
              </View>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={closeAdd}
                disabled={addBusy}
                activeOpacity={0.8}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, addBusy && { opacity: 0.6 }]}
                onPress={handleAdd}
                disabled={addBusy}
                activeOpacity={0.85}
              >
                {addBusy
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Text style={styles.modalConfirmText}>Create Account</Text>
                }
              </TouchableOpacity>
            </View>

          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════
          Set Password Modal
      ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={showSetPw}
        transparent
        animationType="slide"
        onRequestClose={closeSetPassword}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>

            <View style={styles.modalHeader}>
              <View style={[styles.modalIconWrap, { backgroundColor: '#EFF6FF' }]}>
                <Ionicons name="key-outline" size={22} color="#2980B9" />
              </View>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>Set Password</Text>
                <Text style={styles.modalSub} numberOfLines={1}>
                  {setPwTarget?.full_name ?? setPwTarget?.email}
                </Text>
              </View>
              <TouchableOpacity
                onPress={closeSetPassword}
                disabled={setPwBusy}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color={Colors.secondaryText} />
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>New Password</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="lock-closed-outline" size={17} color={Colors.secondaryText} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Min. 6 characters"
                placeholderTextColor={Colors.secondaryText}
                value={newPw}
                onChangeText={v => { setNewPw(v); setSetPwError(''); }}
                secureTextEntry={!showNewPw}
                returnKeyType="next"
                autoFocus
              />
              <TouchableOpacity onPress={() => setShowNewPw(v => !v)} style={styles.eyeBtn}>
                <Ionicons
                  name={showNewPw ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color={Colors.secondaryText}
                />
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Confirm Password</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="lock-closed-outline" size={17} color={Colors.secondaryText} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Re-enter new password"
                placeholderTextColor={Colors.secondaryText}
                value={confirmPw}
                onChangeText={v => { setConfirmPw(v); setSetPwError(''); }}
                secureTextEntry={!showConfirmPw}
                returnKeyType="done"
                onSubmitEditing={handleSetPassword}
              />
              <TouchableOpacity onPress={() => setShowConfirmPw(v => !v)} style={styles.eyeBtn}>
                <Ionicons
                  name={showConfirmPw ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color={Colors.secondaryText}
                />
              </TouchableOpacity>
            </View>

            {!!setPwError && (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle-outline" size={14} color="#C0392B" />
                <Text style={styles.errorText}>{setPwError}</Text>
              </View>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={closeSetPassword}
                disabled={setPwBusy}
                activeOpacity={0.8}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, setPwBusy && { opacity: 0.6 }]}
                onPress={handleSetPassword}
                disabled={setPwBusy}
                activeOpacity={0.85}
              >
                {setPwBusy
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Text style={styles.modalConfirmText}>Update Password</Text>
                }
              </TouchableOpacity>
            </View>

          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════
          Edit Name Modal
      ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={!!editTarget}
        transparent
        animationType="fade"
        onRequestClose={closeEdit}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>

            <View style={styles.modalHeader}>
              <View style={[styles.modalIconWrap, { backgroundColor: Colors.inputBackground }]}>
                <Ionicons name="create-outline" size={22} color={Colors.navy} />
              </View>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>Edit Display Name</Text>
                <Text style={styles.modalSub} numberOfLines={1}>{editTarget?.email}</Text>
              </View>
              <TouchableOpacity
                onPress={closeEdit}
                disabled={editBusy}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color={Colors.secondaryText} />
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Display Name</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="person-outline" size={17} color={Colors.secondaryText} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={editName}
                onChangeText={v => { setEditName(v); setEditError(''); }}
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={handleEdit}
                autoFocus
              />
            </View>

            {!!editError && (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle-outline" size={14} color="#C0392B" />
                <Text style={styles.errorText}>{editError}</Text>
              </View>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={closeEdit}
                disabled={editBusy}
                activeOpacity={0.8}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, editBusy && { opacity: 0.6 }]}
                onPress={handleEdit}
                disabled={editBusy}
                activeOpacity={0.85}
              >
                {editBusy
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Text style={styles.modalConfirmText}>Save</Text>
                }
              </TouchableOpacity>
            </View>

          </View>
        </KeyboardAvoidingView>
      </Modal>

    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // ── Header ──
  header: {
    backgroundColor: Colors.navy,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn:     { width: 36, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: Colors.white, textAlign: 'center' },
  addBtn:      { width: 36, alignItems: 'flex-end', justifyContent: 'center' },

  // ── List ──
  listContent: { padding: 16, paddingBottom: 32 },
  listNote: {
    fontSize: 12,
    color: Colors.secondaryText,
    marginBottom: 14,
    textAlign: 'center',
  },

  card: {
    backgroundColor: Colors.white,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    marginBottom: 10,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: { fontSize: 15, fontWeight: '800', color: Colors.white },
  cardInfo:   { flex: 1, paddingHorizontal: 12 },
  cardName:   { fontSize: 14, fontWeight: '700', color: Colors.navy },
  cardEmail:  { fontSize: 12, color: Colors.secondaryText, marginTop: 2 },
  cardMeta:   { fontSize: 11, color: Colors.secondaryText, marginTop: 3 },

  salesBadge: { alignItems: 'center', flexShrink: 0, marginLeft: 4 },
  salesCount: { fontSize: 16, fontWeight: '800', color: Colors.navy },
  salesLabel: { fontSize: 10, color: Colors.secondaryText, fontWeight: '500' },

  // ── Empty / error / loading ──
  centered:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  centeredText: { fontSize: 15, fontWeight: '600', color: Colors.navy, textAlign: 'center' },
  centeredSub:  { fontSize: 13, color: Colors.secondaryText, textAlign: 'center' },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.navy,
  },
  retryText: { fontSize: 13, fontWeight: '700', color: Colors.white },

  // ── Shared modal shell ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 36,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 22,
  },
  modalIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  modalHeaderText: { flex: 1 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: Colors.navy },
  modalSub:   { fontSize: 12, color: Colors.secondaryText, marginTop: 2 },

  // ── Actions sheet internals ──
  sheetProfile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
  },
  sheetAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sheetAvatarText:  { fontSize: 16, fontWeight: '800', color: Colors.white },
  sheetProfileInfo: { flex: 1 },
  sheetName:        { fontSize: 15, fontWeight: '700', color: Colors.navy },
  sheetEmail:       { fontSize: 12, color: Colors.secondaryText, marginTop: 2 },
  sheetDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginBottom: 16,
  },
  sheetAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    marginBottom: 4,
  },
  sheetActionIcon: {
    width: 42,
    height: 42,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sheetActionText:  { flex: 1 },
  sheetActionLabel: { fontSize: 14, fontWeight: '600', color: Colors.navy },
  sheetActionSub:   { fontSize: 12, color: Colors.secondaryText, marginTop: 2 },
  sheetCancel: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.inputBackground,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  sheetCancelText: { fontSize: 14, fontWeight: '700', color: Colors.secondaryText },

  // ── Form fields ──
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
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  errorText: { flex: 1, fontSize: 13, color: '#C0392B' },

  modalActions: { flexDirection: 'row', gap: 10 },
  modalCancel: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.inputBackground,
  },
  modalCancelText: { fontSize: 14, fontWeight: '700', color: Colors.secondaryText },
  modalConfirm: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.navy,
  },
  modalConfirmText: { fontSize: 14, fontWeight: '700', color: Colors.white },
});
