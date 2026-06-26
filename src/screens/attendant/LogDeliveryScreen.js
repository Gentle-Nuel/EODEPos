import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabase';
import ProductAvatar from '../../components/ProductAvatar';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = n =>
  '₦' + Number(n).toLocaleString('en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

const fmtDate = iso => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    + ', '
    + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
};

const STATUS_CONFIG = {
  pending:  { label: 'Pending',  bg: '#FEF3C7', text: '#92400E', border: '#F59E0B' },
  approved: { label: 'Approved', bg: '#D1FAE5', text: '#065F46', border: '#34D399' },
  rejected: { label: 'Rejected', bg: '#FEE2E2', text: '#B91C1C', border: '#FCA5A5' },
};

function fmtDeliveryQty(qty, deliveryUnit, upc) {
  const n = Number(qty);
  const whole = Math.floor(n);
  const half  = n % 1 !== 0;
  const numStr = half ? (whole > 0 ? `${whole}½` : '½') : String(whole);
  if (deliveryUnit === 'carton') {
    const suffix = `carton${n !== 1 ? 's' : ''}`;
    if (upc) return `${numStr} ${suffix} (${n * upc} units)`;
    return `${numStr} ${suffix}`;
  }
  if (half) return `${numStr} pack${n >= 1 ? 's' : ''}`;
  return `${numStr} unit${n !== 1 ? 's' : ''}`;
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
      <Text style={[styles.badgeText, { color: cfg.text }]}>{cfg.label}</Text>
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function LogDeliveryScreen() {
  const { user } = useAuth();

  // ── Form state ─────────────────────────────────────────────────────────────
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [deliveryUnit, setDeliveryUnit]       = useState('unit'); // 'unit' | 'carton'
  const [quantity, setQuantity]               = useState('');
  const [note, setNote]                       = useState('');
  const [submitting, setSubmitting]           = useState(false);

  // ── Product picker modal ───────────────────────────────────────────────────
  const [pickerOpen, setPickerOpen]   = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [products, setProducts]       = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  // ── Recent deliveries ──────────────────────────────────────────────────────
  const [deliveries, setDeliveries]     = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState(null);

  // ── Success flash ──────────────────────────────────────────────────────────
  const [successVisible, setSuccessVisible] = useState(false);

  // ─────────────────────────────────────────────────────────────────────────

  const fetchProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, price, stock_quantity, unit_description, image_url, units_per_carton, allow_half')
        .order('name', { ascending: true });
      if (error) throw error;
      setProducts(data ?? []);
    } catch (err) {
      // Products are shown inside the picker — silently fall through
      // so the form can still load; user will see empty picker list
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  const fetchDeliveries = useCallback(async () => {
    setHistoryError(null);
    setLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from('deliveries')
        .select(`
          id,
          quantity_received,
          delivery_unit,
          note,
          status,
          rejection_reason,
          created_at,
          products ( name, units_per_carton )
        `)
        .eq('logged_by', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      setDeliveries(data ?? []);
    } catch (err) {
      setHistoryError(err.message ?? 'Could not load delivery history.');
    } finally {
      setLoadingHistory(false);
    }
  }, [user.id]);

  useEffect(() => {
    fetchProducts();
    fetchDeliveries();
  }, [fetchProducts, fetchDeliveries]);

  // ── Filtered products for picker search ────────────────────────────────────

  const filteredProducts = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    return q ? products.filter(p => p.name.toLowerCase().includes(q)) : products;
  }, [products, pickerSearch]);

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!selectedProduct) {
      Alert.alert('No Product', 'Please select a product first.');
      return;
    }
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0 || isNaN(qty)) {
      Alert.alert('Invalid Quantity', 'Please enter a valid quantity (must be greater than 0).');
      return;
    }
    if (selectedProduct?.allow_half && deliveryUnit === 'unit') {
      if (Math.abs(qty * 2 - Math.round(qty * 2)) > 0.001) {
        Alert.alert('Invalid Quantity', 'Quantity must be a whole number or half (e.g. 2, 2.5).');
        return;
      }
    } else if (deliveryUnit === 'unit' && !Number.isInteger(qty)) {
      Alert.alert('Invalid Quantity', 'Quantity must be a whole number for this product.');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from('deliveries').insert({
        logged_by:         user.id,
        product_id:        selectedProduct.id,
        quantity_received: qty,
        delivery_unit:     deliveryUnit,
        note:              note.trim() || null,
      });
      if (error) throw error;

      // Reset form
      setSelectedProduct(null);
      setDeliveryUnit('unit');
      setQuantity('');
      setNote('');

      // Flash success + refresh history
      setSuccessVisible(true);
      setTimeout(() => setSuccessVisible(false), 3000);
      fetchDeliveries();

    } catch (err) {
      Alert.alert('Submission Failed', err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [selectedProduct, quantity, note, deliveryUnit, user.id, fetchDeliveries]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const canSubmit = selectedProduct && quantity.trim().length > 0 && !submitting;

  const renderDelivery = useCallback(({ item }) => (
    <View style={styles.deliveryCard}>
      <View style={styles.deliveryTop}>
        <View style={styles.deliveryInfo}>
          <Text style={styles.deliveryProduct} numberOfLines={1}>
            {item.products?.name ?? '—'}
          </Text>
          <Text style={styles.deliveryQty}>
            Qty: <Text style={styles.deliveryQtyNum}>{fmtDeliveryQty(item.quantity_received, item.delivery_unit, item.products?.units_per_carton)}</Text>
          </Text>
          {!!item.note && (
            <Text style={styles.deliveryNote} numberOfLines={2}>{item.note}</Text>
          )}
          <Text style={styles.deliveryDate}>{fmtDate(item.created_at)}</Text>
        </View>
        <StatusBadge status={item.status} />
      </View>
      {item.status === 'rejected' && !!item.rejection_reason && (
        <View style={styles.rejectionBox}>
          <Ionicons name="close-circle-outline" size={13} color="#B91C1C" />
          <Text style={styles.rejectionText} numberOfLines={2}>
            {item.rejection_reason}
          </Text>
        </View>
      )}
    </View>
  ), []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Log Delivery</Text>
        <Text style={styles.headerSub}>Record incoming stock for admin approval</Text>
      </View>

      {/* ── Success Banner ── */}
      {successVisible && (
        <View style={styles.successBanner}>
          <Ionicons name="checkmark-circle" size={16} color="#fff" />
          <Text style={styles.successText}>
            Delivery logged! Waiting for admin approval.
          </Text>
        </View>
      )}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ══ FORM CARD ══ */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>New Delivery Entry</Text>

            {/* Product selector */}
            <Text style={styles.fieldLabel}>Product <Text style={styles.required}>*</Text></Text>
            <TouchableOpacity
              style={styles.selectorBtn}
              onPress={() => {
                setPickerSearch('');
                setPickerOpen(true);
              }}
              activeOpacity={0.85}
            >
              {selectedProduct ? (
                <View style={styles.selectorSelected}>
                  <View style={styles.selectorDot} />
                  <View style={styles.selectorSelectedText}>
                    <Text style={styles.selectorName} numberOfLines={1}>
                      {selectedProduct.name}
                    </Text>
                    {!!selectedProduct.unit_description && (
                      <Text style={styles.selectorUnit}>{selectedProduct.unit_description}</Text>
                    )}
                  </View>
                </View>
              ) : (
                <Text style={styles.selectorPlaceholder}>Select a product…</Text>
              )}
              <Ionicons name="chevron-down" size={17} color={Colors.secondaryText} />
            </TouchableOpacity>

            {/* Carton / Unit toggle — only for carton products */}
            {!!selectedProduct?.units_per_carton && (
              <View style={styles.unitToggleWrap}>
                <TouchableOpacity
                  style={[styles.unitToggleBtn, deliveryUnit === 'carton' && styles.unitToggleBtnActive]}
                  onPress={() => setDeliveryUnit('carton')}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.unitToggleText, deliveryUnit === 'carton' && styles.unitToggleTextActive]}>
                    Cartons
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.unitToggleBtn, deliveryUnit === 'unit' && styles.unitToggleBtnActive]}
                  onPress={() => setDeliveryUnit('unit')}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.unitToggleText, deliveryUnit === 'unit' && styles.unitToggleTextActive]}>
                    Units
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            {!!selectedProduct?.units_per_carton && deliveryUnit === 'carton' && (
              <Text style={styles.unitHint}>
                1 carton = {selectedProduct.units_per_carton} units · stock updates in units when approved
              </Text>
            )}

            {/* Quantity */}
            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>
              Quantity Received ({deliveryUnit === 'carton' ? 'cartons' : 'units'}) <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              placeholder={selectedProduct?.allow_half && deliveryUnit === 'unit' ? 'e.g. 20 or 20.5' : 'e.g. 20'}
              placeholderTextColor={Colors.secondaryText}
              keyboardType={selectedProduct?.allow_half && deliveryUnit === 'unit' ? 'decimal-pad' : 'numeric'}
              value={quantity}
              onChangeText={v => {
                if (selectedProduct?.allow_half && deliveryUnit === 'unit') {
                  setQuantity(v.replace(/[^0-9.]/g, '').replace(/(\..*?)\./g, '$1'));
                } else {
                  setQuantity(v.replace(/[^0-9]/g, ''));
                }
              }}
              maxLength={8}
            />
            {selectedProduct?.allow_half && deliveryUnit === 'unit' && (
              <Text style={styles.unitHint}>Halves allowed — e.g. 2.5</Text>
            )}

            {/* Note */}
            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Note (optional)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              placeholder="Supplier name, invoice number, condition, etc."
              placeholderTextColor={Colors.secondaryText}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              value={note}
              onChangeText={setNote}
              maxLength={300}
            />

            {/* Submit */}
            <TouchableOpacity
              style={[styles.submitBtn, (!canSubmit) && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={!canSubmit}
              activeOpacity={0.88}
            >
              {submitting ? (
                <ActivityIndicator color={Colors.navy} size="small" />
              ) : (
                <>
                  <Ionicons
                    name="cloud-upload-outline"
                    size={18}
                    color={canSubmit ? Colors.navy : Colors.secondaryText}
                    style={{ marginRight: 8 }}
                  />
                  <Text style={[styles.submitBtnText, !canSubmit && styles.submitBtnTextDisabled]}>
                    Submit for Approval
                  </Text>
                </>
              )}
            </TouchableOpacity>

            {/* Info note */}
            <View style={styles.infoRow}>
              <Ionicons name="information-circle-outline" size={14} color={Colors.secondaryText} />
              <Text style={styles.infoText}>
                Deliveries must be approved by an admin before stock is updated.
              </Text>
            </View>
          </View>

          {/* ══ RECENT DELIVERIES ══ */}
          <View style={styles.historySection}>
            <View style={styles.historySectionHeader}>
              <Text style={styles.historySectionTitle}>My Recent Deliveries</Text>
              <TouchableOpacity
                onPress={fetchDeliveries}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="refresh-outline" size={17} color={Colors.navy} />
              </TouchableOpacity>
            </View>

            {loadingHistory ? (
              <View style={styles.historyCenter}>
                <ActivityIndicator size="small" color={Colors.navy} />
              </View>
            ) : historyError ? (
              <View style={styles.historyCenter}>
                <Text style={styles.historyError}>{historyError}</Text>
              </View>
            ) : deliveries.length === 0 ? (
              <View style={styles.historyCenter}>
                <Ionicons name="cube-outline" size={36} color={Colors.border} />
                <Text style={styles.historyEmpty}>No deliveries logged yet</Text>
              </View>
            ) : (
              deliveries.map(d => (
                <View key={d.id} style={styles.deliveryCard}>
                  <View style={styles.deliveryTop}>
                    <View style={styles.deliveryInfo}>
                      <Text style={styles.deliveryProduct} numberOfLines={1}>
                        {d.products?.name ?? '—'}
                      </Text>
                      <Text style={styles.deliveryQty}>
                        Qty: <Text style={styles.deliveryQtyNum}>{fmtDeliveryQty(d.quantity_received, d.delivery_unit, d.products?.units_per_carton)}</Text>
                      </Text>
                      {!!d.note && (
                        <Text style={styles.deliveryNote} numberOfLines={2}>{d.note}</Text>
                      )}
                      <Text style={styles.deliveryDate}>{fmtDate(d.created_at)}</Text>
                    </View>
                    <StatusBadge status={d.status} />
                  </View>
                  {d.status === 'rejected' && !!d.rejection_reason && (
                    <View style={styles.rejectionBox}>
                      <Ionicons name="close-circle-outline" size={13} color="#B91C1C" />
                      <Text style={styles.rejectionText} numberOfLines={2}>
                        {d.rejection_reason}
                      </Text>
                    </View>
                  )}
                </View>
              ))
            )}
          </View>

        </ScrollView>
      </KeyboardAvoidingView>

      {/* ══ PRODUCT PICKER MODAL ══ */}
      <Modal
        visible={pickerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerOpen(false)}
      >
        <SafeAreaView style={styles.modalRoot} edges={['top']}>
          {/* Modal header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Product</Text>
            <TouchableOpacity
              style={styles.modalClose}
              onPress={() => setPickerOpen(false)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={22} color={Colors.white} />
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.modalSearchBar}>
            <Ionicons name="search-outline" size={15} color={Colors.secondaryText} />
            <TextInput
              style={styles.modalSearchInput}
              placeholder="Search products…"
              placeholderTextColor={Colors.secondaryText}
              value={pickerSearch}
              onChangeText={setPickerSearch}
              autoFocus
              returnKeyType="search"
            />
            {pickerSearch.length > 0 && (
              <TouchableOpacity onPress={() => setPickerSearch('')}>
                <Ionicons name="close-circle" size={15} color={Colors.secondaryText} />
              </TouchableOpacity>
            )}
          </View>

          {/* Product list */}
          {loadingProducts ? (
            <View style={styles.pickerCenter}>
              <ActivityIndicator size="large" color={Colors.navy} />
            </View>
          ) : filteredProducts.length === 0 ? (
            <View style={styles.pickerCenter}>
              <Ionicons name="search-outline" size={40} color={Colors.border} />
              <Text style={styles.pickerEmpty}>
                {pickerSearch ? `No products match "${pickerSearch}"` : 'No products available'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredProducts}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const isSelected = selectedProduct?.id === item.id;
                return (
                  <TouchableOpacity
                    style={[styles.pickerItem, isSelected && styles.pickerItemSelected]}
                    onPress={() => {
                      setSelectedProduct(item);
                      setDeliveryUnit(item.units_per_carton ? 'carton' : 'unit');
                      setQuantity('');
                      setPickerOpen(false);
                    }}
                    activeOpacity={0.8}
                  >
                    <ProductAvatar imageUrl={item.image_url} name={item.name} size={38} borderRadius={9} />
                    <View style={[styles.pickerItemLeft, { marginLeft: 10 }]}>
                      <Text style={[styles.pickerItemName, isSelected && styles.pickerItemNameSelected]}>
                        {item.name}
                      </Text>
                      <View style={styles.pickerItemMeta}>
                        {!!item.unit_description && (
                          <Text style={styles.pickerItemUnit}>{item.unit_description}</Text>
                        )}
                        <Text style={styles.pickerItemStock}>
                          {item.stock_quantity} in stock
                        </Text>
                      </View>
                    </View>
                    <View style={styles.pickerItemRight}>
                      <Text style={[styles.pickerItemPrice, isSelected && styles.pickerItemPriceSelected]}>
                        {fmt(item.price)}
                      </Text>
                      {isSelected && (
                        <Ionicons name="checkmark-circle" size={18} color={Colors.navy} style={{ marginTop: 4 }} />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={styles.pickerSep} />}
              contentContainerStyle={{ paddingBottom: 40 }}
            />
          )}
        </SafeAreaView>
      </Modal>

    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:  { flex: 1, backgroundColor: Colors.background },
  flex:  { flex: 1 },

  /* Header */
  header: {
    backgroundColor: Colors.navy,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 18,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.white,
    letterSpacing: 0.3,
  },
  headerSub: {
    fontSize: 12,
    color: Colors.secondaryText,
    marginTop: 3,
  },

  /* Success banner */
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#065F46',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  successText: {
    flex: 1,
    fontSize: 13,
    color: '#fff',
    fontWeight: '500',
  },

  scrollContent: { padding: 16, paddingBottom: 32 },

  /* Form card */
  card: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 20,
    shadowColor: '#1B2A6B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.navy,
    marginBottom: 18,
  },

  /* Field label */
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.navy,
    marginBottom: 7,
  },
  required: { color: '#C0392B' },

  /* Product selector button */
  selectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.inputBackground,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  selectorPlaceholder: {
    fontSize: 14,
    color: Colors.secondaryText,
  },
  selectorSelected: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  selectorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.gold,
    flexShrink: 0,
  },
  selectorSelectedText: { flex: 1 },
  selectorName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.navy,
  },
  selectorUnit: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginTop: 1,
  },

  /* Carton / Unit toggle */
  unitToggleWrap: {
    flexDirection: 'row',
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  unitToggleBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: Colors.inputBackground,
  },
  unitToggleBtnActive: {
    backgroundColor: Colors.navy,
  },
  unitToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.secondaryText,
  },
  unitToggleTextActive: {
    color: Colors.white,
  },
  unitHint: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginTop: 6,
    lineHeight: 16,
  },

  /* Text inputs */
  input: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontWeight: '500',
    color: Colors.navy,
  },
  inputMultiline: {
    height: 88,
    paddingTop: 12,
  },

  /* Submit button */
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.gold,
    borderRadius: 13,
    height: 52,
    marginTop: 20,
    shadowColor: Colors.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  submitBtnDisabled: {
    backgroundColor: Colors.inputBackground,
    shadowOpacity: 0,
    elevation: 0,
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.navy,
    letterSpacing: 0.2,
  },
  submitBtnTextDisabled: { color: Colors.secondaryText },

  /* Info note */
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 11,
    color: Colors.secondaryText,
    lineHeight: 16,
  },

  /* History section */
  historySection: { gap: 10 },
  historySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  historySectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.navy,
  },
  historyCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 10,
  },
  historyEmpty: {
    fontSize: 13,
    color: Colors.secondaryText,
    textAlign: 'center',
  },
  historyError: {
    fontSize: 13,
    color: '#C0392B',
    textAlign: 'center',
  },

  /* Delivery card */
  deliveryCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 14,
    shadowColor: '#1B2A6B',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 10,
  },
  deliveryTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  deliveryInfo: { flex: 1 },
  deliveryProduct: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.navy,
    marginBottom: 3,
  },
  deliveryQty: {
    fontSize: 12,
    color: Colors.secondaryText,
  },
  deliveryQtyNum: {
    fontWeight: '700',
    color: Colors.navy,
  },
  deliveryNote: {
    fontSize: 11,
    color: Colors.secondaryText,
    fontStyle: 'italic',
    marginTop: 3,
  },
  deliveryDate: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginTop: 5,
  },

  /* Status badge */
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    flexShrink: 0,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },

  /* Rejection reason */
  rejectionBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 10,
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    padding: 10,
  },
  rejectionText: {
    flex: 1,
    fontSize: 12,
    color: '#B91C1C',
    lineHeight: 17,
  },

  /* ── MODAL ── */
  modalRoot: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.navy,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.white,
  },
  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  modalSearchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.navy,
    padding: 0,
  },
  pickerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  pickerEmpty: {
    fontSize: 14,
    color: Colors.secondaryText,
    textAlign: 'center',
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Colors.white,
  },
  pickerItemSelected: {
    backgroundColor: Colors.inputBackground,
  },
  pickerItemLeft: { flex: 1, paddingRight: 12 },
  pickerItemName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.navy,
  },
  pickerItemNameSelected: { color: Colors.navy },
  pickerItemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 3,
  },
  pickerItemUnit: {
    fontSize: 11,
    color: Colors.secondaryText,
  },
  pickerItemStock: {
    fontSize: 11,
    color: Colors.secondaryText,
  },
  pickerItemRight: { alignItems: 'flex-end' },
  pickerItemPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.navy,
  },
  pickerItemPriceSelected: { color: Colors.navy },
  pickerSep: {
    height: 1,
    backgroundColor: Colors.border,
    marginLeft: 16,
  },
});
