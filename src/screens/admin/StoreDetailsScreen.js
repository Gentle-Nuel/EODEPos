import React, { useState, useEffect, useCallback } from 'react';
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
import { Colors } from '../../constants/colors';
import { supabase } from '../../lib/supabase';

// ─── Constants ────────────────────────────────────────────────────────────────

const STORE_ROW_ID = 'store'; // singleton row in the settings table

// ─── Field config ─────────────────────────────────────────────────────────────

const FIELDS = [
  {
    key: 'business_name',
    label: 'Business Name',
    placeholder: 'e.g. Ebenezer-Online Digital Enterprise',
    icon: 'storefront-outline',
    capitalize: 'words',
    keyboard: 'default',
  },
  {
    key: 'tagline',
    label: 'Tagline',
    placeholder: 'e.g. Surplus Value Services & Products',
    icon: 'text-outline',
    capitalize: 'sentences',
    keyboard: 'default',
  },
  {
    key: 'address',
    label: 'Address',
    placeholder: 'Street, City, State',
    icon: 'location-outline',
    capitalize: 'words',
    keyboard: 'default',
    multiline: true,
  },
  {
    key: 'phone',
    label: 'Phone Number',
    placeholder: 'e.g. 0801 234 5678',
    icon: 'call-outline',
    capitalize: 'none',
    keyboard: 'phone-pad',
  },
  {
    key: 'email',
    label: 'Contact Email',
    placeholder: 'store@example.com',
    icon: 'mail-outline',
    capitalize: 'none',
    keyboard: 'email-address',
  },
];

const EMPTY = {
  business_name: '',
  tagline: '',
  address: '',
  phone: '',
  email: '',
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StoreDetailsScreen({ navigation }) {
  const [form, setForm]         = useState(EMPTY);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved]       = useState(false);

  // ── Load ───────────────────────────────────────────────────────────────────

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('settings')
        .select('business_name, tagline, address, phone, email')
        .eq('id', STORE_ROW_ID)
        .maybeSingle();

      if (err) throw err;
      if (data) {
        setForm({
          business_name: data.business_name ?? '',
          tagline:       data.tagline       ?? '',
          address:       data.address       ?? '',
          phone:         data.phone         ?? '',
          email:         data.email         ?? '',
        });
      }
    } catch (err) {
      setError(err.message ?? 'Could not load store details.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    const name = form.business_name.trim();
    if (!name) {
      setSaveError('Business name is required.');
      return;
    }

    setSaving(true);
    setSaveError('');
    setSaved(false);

    try {
      const { error: err } = await supabase
        .from('settings')
        .upsert(
          {
            id:            STORE_ROW_ID,
            business_name: form.business_name.trim(),
            tagline:       form.tagline.trim(),
            address:       form.address.trim(),
            phone:         form.phone.trim(),
            email:         form.email.trim().toLowerCase(),
          },
          { onConflict: 'id' },
        );

      if (err) throw err;

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(err.message ?? 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [form]);

  const setField = useCallback((key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setSaveError('');
    setSaved(false);
  }, []);

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
        <Text style={styles.headerTitle}>Store Details</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.navy} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={44} color="#C0392B" />
          <Text style={[styles.centeredText, { color: '#C0392B' }]}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadSettings}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.sectionNote}>
              This information appears on printed and shared receipts.
            </Text>

            {FIELDS.map(f => (
              <View key={f.key}>
                <Text style={styles.fieldLabel}>{f.label}</Text>
                <View style={[styles.inputWrapper, f.multiline && styles.inputWrapperMulti]}>
                  <Ionicons
                    name={f.icon}
                    size={17}
                    color={Colors.secondaryText}
                    style={[styles.inputIcon, f.multiline && { marginTop: 15 }]}
                  />
                  <TextInput
                    style={[styles.input, f.multiline && styles.inputMulti]}
                    placeholder={f.placeholder}
                    placeholderTextColor={Colors.secondaryText}
                    value={form[f.key]}
                    onChangeText={v => setField(f.key, v)}
                    autoCapitalize={f.capitalize}
                    keyboardType={f.keyboard}
                    autoCorrect={false}
                    multiline={f.multiline ?? false}
                    numberOfLines={f.multiline ? 3 : 1}
                    textAlignVertical={f.multiline ? 'top' : 'center'}
                    returnKeyType={f.multiline ? 'default' : 'next'}
                  />
                </View>
              </View>
            ))}

            {/* Save error */}
            {!!saveError && (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle-outline" size={14} color="#C0392B" />
                <Text style={styles.errorText}>{saveError}</Text>
              </View>
            )}

            {/* Success feedback */}
            {saved && (
              <View style={styles.successRow}>
                <Ionicons name="checkmark-circle-outline" size={14} color="#065F46" />
                <Text style={styles.successText}>Store details saved successfully.</Text>
              </View>
            )}

            {/* Save button */}
            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator size="small" color={Colors.navy} />
                : (
                  <>
                    <Ionicons name="checkmark-outline" size={18} color={Colors.navy} style={{ marginRight: 8 }} />
                    <Text style={styles.saveBtnText}>Save Details</Text>
                  </>
                )
              }
            </TouchableOpacity>

          </ScrollView>
        </KeyboardAvoidingView>
      )}
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

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  centeredText: { fontSize: 14, color: Colors.secondaryText, textAlign: 'center' },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.navy,
  },
  retryText: { fontSize: 13, fontWeight: '700', color: Colors.white },

  scroll: { padding: 20, paddingBottom: 40 },
  sectionNote: {
    fontSize: 13,
    color: Colors.secondaryText,
    marginBottom: 24,
    lineHeight: 19,
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
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    marginBottom: 18,
    height: 50,
  },
  inputWrapperMulti: {
    height: 'auto',
    alignItems: 'flex-start',
    paddingVertical: 12,
  },
  inputIcon: { marginRight: 8 },
  input: {
    flex: 1,
    fontSize: 14,
    color: Colors.navy,
    paddingVertical: 0,
  },
  inputMulti: {
    minHeight: 70,
    paddingTop: 2,
  },

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

  successRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#D1FAE5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#34D399',
  },
  successText: { flex: 1, fontSize: 13, color: '#065F46', fontWeight: '600' },

  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.gold,
    borderRadius: 13,
    height: 52,
    marginTop: 8,
    shadowColor: Colors.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  saveBtnText: { fontSize: 15, fontWeight: '800', color: Colors.navy },
});
