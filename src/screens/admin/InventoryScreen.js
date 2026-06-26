import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '../../constants/colors';
import { supabase } from '../../lib/supabase';
import ProductAvatar from '../../components/ProductAvatar';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = n =>
  '₦' + Number(n).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const EMPTY_FORM = {
  name:                '',
  price:               '',
  unit_description:    '',
  stock_quantity:      '',
  low_stock_threshold: '',
  image_url:           '',
  units_per_carton:    '',
  carton_price:        '',
  allow_half:          false,
};

function toForm(product) {
  return {
    name:                product.name ?? '',
    price:               String(product.price ?? ''),
    unit_description:    product.unit_description ?? '',
    stock_quantity:      String(product.stock_quantity ?? ''),
    low_stock_threshold: String(product.low_stock_threshold ?? ''),
    image_url:           product.image_url ?? '',
    units_per_carton:    product.units_per_carton ? String(product.units_per_carton) : '',
    carton_price:        product.carton_price ? String(product.carton_price) : '',
    allow_half:          product.allow_half ?? false,
  };
}

// Formats stock as "2 ctns + 5 units" for carton products, plain number otherwise
function stockLabel(stock, upc) {
  const s = Number(stock);
  if (!upc) return String(s % 1 === 0 ? s : s.toFixed(1));
  const cartons = Math.floor(s / upc);
  const units   = Number((s % upc).toFixed(2));
  if (cartons === 0) return `${units} unit${units !== 1 ? 's' : ''}`;
  if (units   === 0) return `${cartons} ctn${cartons !== 1 ? 's' : ''}`;
  return `${cartons} ctn${cartons !== 1 ? 's' : ''} + ${units} unit${units !== 1 ? 's' : ''}`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function InventoryScreen() {
  const [products, setProducts]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState(null);
  const [search, setSearch]         = useState('');

  // Modal state
  const [modalVisible, setModalVisible]       = useState(false);
  const [editTarget, setEditTarget]           = useState(null); // null = adding new
  const [form, setForm]                       = useState(EMPTY_FORM);
  const [saving, setSaving]                   = useState(false);
  const [deleting, setDeleting]               = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [uploadingImage, setUploadingImage]       = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchProducts = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('products')
        .select('id, name, price, stock_quantity, low_stock_threshold, unit_description, image_url, units_per_carton, carton_price, allow_half')
        .order('name', { ascending: true });
      if (err) throw err;
      setProducts(data ?? []);
    } catch (err) {
      setError(err.message ?? 'Could not load products.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // ── Modal helpers ──────────────────────────────────────────────────────────

  const openAdd = useCallback(() => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setShowDeleteConfirm(false);
    setModalVisible(true);
  }, []);

  const openEdit = useCallback((product) => {
    setEditTarget(product);
    setForm(toForm(product));
    setShowDeleteConfirm(false);
    setModalVisible(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setShowDeleteConfirm(false);
  }, []);

  const setField = useCallback((key, val) => {
    setForm(prev => ({ ...prev, [key]: val }));
  }, []);

  // ── Image picker & upload ──────────────────────────────────────────────────

  const pickAndUploadImage = useCallback(async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow access to your photo library in settings.');
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    setUploadingImage(true);
    try {
      const response  = await fetch(asset.uri);
      const blob      = await response.blob();
      const ext       = (asset.mimeType ?? 'image/jpeg').split('/')[1] ?? 'jpg';
      const filename  = `product-${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('product-images')
        .upload(filename, blob, { contentType: asset.mimeType ?? 'image/jpeg', upsert: true });
      if (uploadErr) throw uploadErr;

      const { data: { publicUrl } } = supabase.storage
        .from('product-images')
        .getPublicUrl(filename);

      setField('image_url', publicUrl);
    } catch (err) {
      Alert.alert('Upload Failed', err.message ?? 'Could not upload image.');
    } finally {
      setUploadingImage(false);
    }
  }, [setField]);

  // ── Validate ───────────────────────────────────────────────────────────────

  const validate = useCallback(() => {
    const name     = form.name.trim();
    const price    = parseFloat(form.price);
    const stock    = parseFloat(form.stock_quantity);
    const low      = parseInt(form.low_stock_threshold, 10);
    const upc      = form.units_per_carton ? parseInt(form.units_per_carton, 10) : null;
    const ctnPrice = form.carton_price ? parseFloat(form.carton_price) : null;

    if (!name)                                                    return 'Product name is required.';
    if (isNaN(price) || price <= 0)                               return 'Price must be a positive number.';
    if (isNaN(stock) || stock < 0)                                return 'Stock quantity must be 0 or more.';
    if (isNaN(low)   || low < 1)                                  return 'Low stock threshold must be at least 1.';
    if (upc !== null && (isNaN(upc) || upc < 2))                  return 'Units per carton must be at least 2.';
    if (upc !== null && (!ctnPrice || isNaN(ctnPrice) || ctnPrice <= 0))
      return 'Carton price is required when units per carton is set.';
    if (form.allow_half && form.units_per_carton)
      return 'A product cannot have both Carton Mode and Allow Half Units enabled.';
    if (form.allow_half && Math.abs(stock * 2 - Math.round(stock * 2)) > 0.001)
      return 'Stock must be a whole number or half (e.g. 2, 2.5).';
    return null;
  }, [form]);

  // ── Save (add or update) ───────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    const validationError = validate();
    if (validationError) {
      Alert.alert('Invalid Input', validationError);
      return;
    }

    const upc = form.units_per_carton ? parseInt(form.units_per_carton, 10) : null;
    const payload = {
      name:                form.name.trim(),
      price:               parseFloat(form.price),
      unit_description:    form.unit_description.trim() || null,
      stock_quantity:      parseFloat(form.stock_quantity),
      low_stock_threshold: parseInt(form.low_stock_threshold, 10),
      image_url:           form.image_url || null,
      units_per_carton:    upc,
      carton_price:        upc && form.carton_price ? parseFloat(form.carton_price) : null,
      allow_half:          form.allow_half,
    };

    setSaving(true);
    try {
      if (editTarget) {
        // Update existing
        const { error: err } = await supabase
          .from('products')
          .update(payload)
          .eq('id', editTarget.id);
        if (err) throw err;
        setProducts(prev =>
          prev
            .map(p => p.id === editTarget.id ? { ...p, ...payload } : p)
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } else {
        // Insert new
        const { data, error: err } = await supabase
          .from('products')
          .insert(payload)
          .select('id, name, price, stock_quantity, low_stock_threshold, unit_description, image_url, units_per_carton, carton_price, allow_half')
          .single();
        if (err) throw err;
        setProducts(prev =>
          [...prev, data].sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
      closeModal();
    } catch (err) {
      Alert.alert('Save Failed', err.message ?? 'Could not save product.');
    } finally {
      setSaving(false);
    }
  }, [form, editTarget, validate, closeModal]);

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async () => {
    if (!editTarget) return;
    setDeleting(true);
    try {
      const { error: err } = await supabase
        .from('products')
        .delete()
        .eq('id', editTarget.id);
      if (err) throw err;
      setProducts(prev => prev.filter(p => p.id !== editTarget.id));
      closeModal();
    } catch (err) {
      Alert.alert('Delete Failed', err.message ?? 'Could not delete product.');
    } finally {
      setDeleting(false);
    }
  }, [editTarget, closeModal]);

  // ── Search filter ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? products.filter(p => p.name.toLowerCase().includes(q)) : products;
  }, [products, search]);

  // ── Render item ────────────────────────────────────────────────────────────

  const renderProduct = useCallback(({ item: p }) => {
    const isLow = p.stock_quantity > 0 && p.stock_quantity <= p.low_stock_threshold;
    const isOut = p.stock_quantity <= 0;

    return (
      <TouchableOpacity style={styles.card} onPress={() => openEdit(p)} activeOpacity={0.75}>
        <ProductAvatar imageUrl={p.image_url} name={p.name} size={44} borderRadius={11} />

        <View style={styles.cardInfo}>
          <Text style={styles.cardName} numberOfLines={1}>{p.name}</Text>
          {!!p.unit_description && (
            <Text style={styles.cardUnit}>{p.unit_description}</Text>
          )}
          <View style={styles.badgeRow}>
            <Text style={styles.stockText}>
              {stockLabel(p.stock_quantity, p.units_per_carton)}
            </Text>
            {isLow && (
              <View style={styles.lowBadge}>
                <Text style={styles.lowBadgeText}>Low</Text>
              </View>
            )}
            {isOut && (
              <View style={styles.outBadge}>
                <Text style={styles.outBadgeText}>Out</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.cardRight}>
          <Text style={styles.cardPrice}>{fmt(p.price)}</Text>
          <Ionicons name="chevron-forward" size={14} color={Colors.secondaryText} />
        </View>
      </TouchableOpacity>
    );
  }, [openEdit]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Inventory</Text>
        <TouchableOpacity style={styles.addBtn} onPress={openAdd} activeOpacity={0.85}>
          <Ionicons name="add" size={20} color={Colors.navy} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={15} color={Colors.secondaryText} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search products…"
            placeholderTextColor={Colors.secondaryText}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={15} color={Colors.secondaryText} />
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.countLabel}>
          {filtered.length} {filtered.length === 1 ? 'product' : 'products'}
        </Text>
      </View>

      {/* List / States */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.navy} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={44} color="#C0392B" />
          <Text style={[styles.centeredText, { color: '#C0392B' }]}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchProducts()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="layers-outline" size={52} color={Colors.border} />
          <Text style={styles.centeredText}>
            {search ? `No products match "${search}"` : 'No products yet'}
          </Text>
          {!search && (
            <TouchableOpacity style={styles.retryBtn} onPress={openAdd}>
              <Text style={styles.retryText}>Add first product</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          renderItem={renderProduct}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchProducts(true)}
              tintColor={Colors.navy}
              colors={[Colors.navy]}
            />
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* ── Add / Edit Modal ── */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            {/* Modal header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editTarget ? 'Edit Product' : 'New Product'}
              </Text>
              <TouchableOpacity onPress={closeModal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={Colors.secondaryText} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              {/* Image picker */}
              <TouchableOpacity
                style={styles.imagePicker}
                onPress={pickAndUploadImage}
                disabled={uploadingImage}
                activeOpacity={0.8}
              >
                {uploadingImage ? (
                  <ActivityIndicator size="large" color={Colors.navy} />
                ) : form.image_url ? (
                  <>
                    <ProductAvatar imageUrl={form.image_url} name={form.name || '?'} size={90} borderRadius={14} />
                    <View style={styles.imageEditBadge}>
                      <Ionicons name="camera" size={13} color={Colors.white} />
                    </View>
                  </>
                ) : (
                  <>
                    <Ionicons name="camera-outline" size={28} color={Colors.secondaryText} />
                    <Text style={styles.imagePickerText}>Add Photo</Text>
                    <Text style={styles.imagePickerSub}>Tap to upload from gallery</Text>
                  </>
                )}
              </TouchableOpacity>

              <Field label="Product Name *">
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Hennessy VS (75cl)"
                  placeholderTextColor={Colors.secondaryText}
                  value={form.name}
                  onChangeText={v => setField('name', v)}
                  returnKeyType="next"
                />
              </Field>

              <Field label="Unit Description">
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 75cl bottle per pack"
                  placeholderTextColor={Colors.secondaryText}
                  value={form.unit_description}
                  onChangeText={v => setField('unit_description', v)}
                  returnKeyType="next"
                />
              </Field>

              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Field label="Price (₦) *">
                    <TextInput
                      style={styles.input}
                      placeholder="0"
                      placeholderTextColor={Colors.secondaryText}
                      value={form.price}
                      onChangeText={v => setField('price', v)}
                      keyboardType="numeric"
                      returnKeyType="next"
                    />
                  </Field>
                </View>
                <View style={{ width: 12 }} />
                <View style={{ flex: 1 }}>
                  <Field label="Stock Qty *">
                    <TextInput
                      style={styles.input}
                      placeholder="0"
                      placeholderTextColor={Colors.secondaryText}
                      value={form.stock_quantity}
                      onChangeText={v => setField('stock_quantity', v)}
                      keyboardType={form.allow_half ? 'decimal-pad' : 'numeric'}
                      returnKeyType="next"
                    />
                    {form.allow_half && (
                      <Text style={styles.fieldHint}>Halves allowed — e.g. 2.5</Text>
                    )}
                  </Field>
                </View>
              </View>

              <Field label="Low Stock Alert Threshold *">
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 5"
                  placeholderTextColor={Colors.secondaryText}
                  value={form.low_stock_threshold}
                  onChangeText={v => setField('low_stock_threshold', v)}
                  keyboardType="numeric"
                  returnKeyType="done"
                />
                <Text style={styles.fieldHint}>
                  Show "Low" badge when stock falls to this number
                </Text>
              </Field>

              {/* ── Carton mode ── */}
              <View style={styles.sectionDivider} />
              <Text style={styles.sectionLabel}>CARTON MODE (OPTIONAL)</Text>

              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Field label="Units per Carton">
                    <TextInput
                      style={[styles.input, form.allow_half && { opacity: 0.38 }]}
                      placeholder="e.g. 12"
                      placeholderTextColor={Colors.secondaryText}
                      value={form.units_per_carton}
                      onChangeText={v => setField('units_per_carton', v.replace(/[^0-9]/g, ''))}
                      keyboardType="numeric"
                      returnKeyType="next"
                      editable={!form.allow_half}
                    />
                  </Field>
                </View>
                <View style={{ width: 12 }} />
                <View style={{ flex: 1 }}>
                  <Field label="Carton Price (₦)">
                    <TextInput
                      style={[styles.input, (!form.units_per_carton || form.allow_half) && { opacity: 0.38 }]}
                      placeholder="0"
                      placeholderTextColor={Colors.secondaryText}
                      value={form.carton_price}
                      onChangeText={v => setField('carton_price', v)}
                      keyboardType="numeric"
                      returnKeyType="next"
                      editable={!!form.units_per_carton && !form.allow_half}
                    />
                  </Field>
                </View>
              </View>
              {form.allow_half ? (
                <Text style={[styles.fieldHint, { marginTop: -8, marginBottom: 16, color: '#B45309' }]}>
                  Carton Mode disabled — not compatible with half units
                </Text>
              ) : !!form.units_per_carton ? (
                <Text style={[styles.fieldHint, { marginTop: -8, marginBottom: 16 }]}>
                  1 carton = {form.units_per_carton} unit{parseInt(form.units_per_carton, 10) !== 1 ? 's' : ''}
                </Text>
              ) : null}

              {/* ── Allow half ── */}
              <View style={[styles.toggleRow, !!form.units_per_carton && { opacity: 0.45 }]}>
                <View style={styles.toggleInfo}>
                  <Text style={styles.toggleLabel}>Allow Half Units</Text>
                  <Text style={styles.toggleHint}>
                    {form.units_per_carton
                      ? 'Not available when Carton Mode is active'
                      : 'Units can be sold in quantities of ½'}
                  </Text>
                </View>
                <Switch
                  value={form.allow_half}
                  onValueChange={v => setField('allow_half', v)}
                  trackColor={{ false: Colors.border, true: Colors.navy }}
                  thumbColor={Colors.white}
                  disabled={!!form.units_per_carton}
                />
              </View>

              {/* Save button */}
              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={Colors.navy} />
                ) : (
                  <Text style={styles.saveBtnText}>
                    {editTarget ? 'Save Changes' : 'Add Product'}
                  </Text>
                )}
              </TouchableOpacity>

              {/* Delete section — edit mode only */}
              {editTarget && (
                <View style={styles.deleteSection}>
                  {!showDeleteConfirm ? (
                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() => setShowDeleteConfirm(true)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="trash-outline" size={15} color="#B91C1C" />
                      <Text style={styles.deleteBtnText}>Delete Product</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.deleteConfirmBox}>
                      <Text style={styles.deleteConfirmText}>
                        Delete "{editTarget.name}"? This cannot be undone.
                      </Text>
                      <View style={styles.deleteConfirmRow}>
                        <TouchableOpacity
                          style={styles.deleteConfirmCancel}
                          onPress={() => setShowDeleteConfirm(false)}
                          disabled={deleting}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.deleteConfirmCancelText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.deleteConfirmOk, deleting && { opacity: 0.6 }]}
                          onPress={handleDelete}
                          disabled={deleting}
                          activeOpacity={0.85}
                        >
                          {deleting ? (
                            <ActivityIndicator size="small" color={Colors.white} />
                          ) : (
                            <Text style={styles.deleteConfirmOkText}>Delete</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              )}

              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  header: {
    backgroundColor: Colors.navy,
    paddingHorizontal: 20,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: Colors.white },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },

  searchWrap: {
    backgroundColor: Colors.white,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.inputBackground,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.navy, padding: 0 },
  countLabel:  { fontSize: 11, color: Colors.secondaryText, fontWeight: '500' },

  listContent: { padding: 16, paddingBottom: 32, gap: 8 },

  card: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 13,
  },
  cardInfo:     { flex: 1, paddingHorizontal: 12 },
  cardName:     { fontSize: 14, fontWeight: '700', color: Colors.navy },
  cardUnit:     { fontSize: 11, color: Colors.secondaryText, marginTop: 1 },
  badgeRow:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  stockText:    { fontSize: 11, color: Colors.secondaryText },
  lowBadge: {
    backgroundColor: '#FEF3C7',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  lowBadgeText: { fontSize: 10, fontWeight: '700', color: '#92400E' },
  outBadge: {
    backgroundColor: '#FEE2E2',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  outBadgeText: { fontSize: 10, fontWeight: '700', color: '#B91C1C' },
  cardRight:  { alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  cardPrice:  { fontSize: 14, fontWeight: '700', color: Colors.navy },

  centered:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  centeredText: { fontSize: 15, fontWeight: '600', color: Colors.navy, textAlign: 'center' },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.navy,
  },
  retryText: { fontSize: 13, fontWeight: '700', color: Colors.white },

  // ── Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 20,
    maxHeight: '92%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: Colors.navy },

  // ── Image picker ──
  imagePicker: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    width: 110,
    height: 110,
    borderRadius: 16,
    backgroundColor: Colors.inputBackground,
    borderWidth: 2,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    marginBottom: 20,
    position: 'relative',
  },
  imageEditBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePickerText: { fontSize: 13, fontWeight: '600', color: Colors.navy, marginTop: 6 },
  imagePickerSub:  { fontSize: 11, color: Colors.secondaryText, marginTop: 2 },

  // ── Form fields ──
  field:      { marginBottom: 16 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.navy,
    marginBottom: 7,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldHint:  { fontSize: 11, color: Colors.secondaryText, marginTop: 5 },
  input: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 14,
    color: Colors.navy,
  },
  row: { flexDirection: 'row' },

  // ── Save button ──
  saveBtn: {
    backgroundColor: Colors.gold,
    borderRadius: 13,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  saveBtnText: { fontSize: 15, fontWeight: '800', color: Colors.navy },

  // ── Carton / half-unit section ──
  sectionDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.secondaryText,
    letterSpacing: 1,
    marginBottom: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingVertical: 4,
  },
  toggleInfo: { flex: 1, paddingRight: 12 },
  toggleLabel: { fontSize: 13, fontWeight: '600', color: Colors.navy },
  toggleHint:  { fontSize: 11, color: Colors.secondaryText, marginTop: 2 },

  // ── Delete section ──
  deleteSection: { marginBottom: 8 },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEE2E2',
  },
  deleteBtnText: { fontSize: 13, fontWeight: '700', color: '#B91C1C' },
  deleteConfirmBox: {
    backgroundColor: '#FEE2E2',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    gap: 12,
  },
  deleteConfirmText: { fontSize: 13, color: '#B91C1C', fontWeight: '500', lineHeight: 18 },
  deleteConfirmRow:  { flexDirection: 'row', gap: 8 },
  deleteConfirmCancel: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 9,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  deleteConfirmCancelText: { fontSize: 13, fontWeight: '600', color: Colors.secondaryText },
  deleteConfirmOk: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 9,
    backgroundColor: '#C0392B',
  },
  deleteConfirmOkText: { fontSize: 13, fontWeight: '700', color: Colors.white },
});
