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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { supabase } from '../../lib/supabase';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS = {
  pending:  { label: 'Pending',  bg: '#FEF3C7', text: '#92400E', border: '#F59E0B', icon: 'time-outline' },
  approved: { label: 'Approved', bg: '#D1FAE5', text: '#065F46', border: '#34D399', icon: 'checkmark-circle-outline' },
  rejected: { label: 'Rejected', bg: '#FEE2E2', text: '#B91C1C', border: '#FCA5A5', icon: 'close-circle-outline' },
};

const FILTERS = [
  { key: 'all',      label: 'All' },
  { key: 'pending',  label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

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

function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
    + ' · '
    + d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DeliveriesScreen() {
  const [deliveries, setDeliveries]   = useState([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState(null);
  const [filter, setFilter]           = useState('all');
  // Approve modal state
  const [approveTarget, setApproveTarget] = useState(null); // delivery object
  const [approving, setApproving]         = useState(false);

  // Reject modal state
  const [rejectTarget, setRejectTarget] = useState(null); // delivery object
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting]       = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchDeliveries = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('deliveries')
        .select(`
          id,
          quantity_received,
          delivery_unit,
          note,
          status,
          rejection_reason,
          created_at,
          products ( name, units_per_carton ),
          profiles!logged_by ( full_name, email )
        `)
        .order('created_at', { ascending: false });

      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      const { data, error: err } = await query;
      if (err) throw err;
      setDeliveries(data ?? []);
    } catch (err) {
      setError(err.message ?? 'Could not load deliveries. Check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => { fetchDeliveries(); }, [fetchDeliveries]);

  // ── Approve ────────────────────────────────────────────────────────────────

  const handleApprove = useCallback((delivery) => {
    setApproveTarget(delivery);
  }, []);

  const closeApproveModal = useCallback(() => {
    setApproveTarget(null);
  }, []);

  const confirmApprove = useCallback(async () => {
    if (!approveTarget) return;
    setApproving(true);
    try {
      const { error: err } = await supabase
        .from('deliveries')
        .update({ status: 'approved' })
        .eq('id', approveTarget.id);
      if (err) throw err;
      setDeliveries(prev =>
        prev.map(d => d.id === approveTarget.id ? { ...d, status: 'approved' } : d),
      );
      closeApproveModal();
    } catch (err) {
      Alert.alert('Error', err.message ?? 'Could not approve delivery.');
    } finally {
      setApproving(false);
    }
  }, [approveTarget, closeApproveModal]);

  // ── Reject ─────────────────────────────────────────────────────────────────

  const openRejectModal = useCallback((delivery) => {
    setRejectTarget(delivery);
    setRejectReason('');
  }, []);

  const closeRejectModal = useCallback(() => {
    setRejectTarget(null);
    setRejectReason('');
  }, []);

  const confirmReject = useCallback(async () => {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) {
      Alert.alert('Reason required', 'Please enter a reason for the rejection.');
      return;
    }

    setRejecting(true);
    try {
      const { error: err } = await supabase
        .from('deliveries')
        .update({ status: 'rejected', rejection_reason: reason })
        .eq('id', rejectTarget.id);
      if (err) throw err;

      setDeliveries(prev =>
        prev.map(d =>
          d.id === rejectTarget.id
            ? { ...d, status: 'rejected', rejection_reason: reason }
            : d,
        ),
      );
      closeRejectModal();
    } catch (err) {
      Alert.alert('Error', err.message ?? 'Could not reject delivery.');
    } finally {
      setRejecting(false);
    }
  }, [rejectTarget, rejectReason, closeRejectModal]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const pendingCount = useMemo(
    () => deliveries.filter(d => d.status === 'pending').length,
    [deliveries],
  );

  // When filter is not 'all', the list is already filtered by the query.
  // When filter is 'all', show everything.
  const visibleDeliveries = deliveries;

  // ── Render item ────────────────────────────────────────────────────────────

  const renderDelivery = useCallback(({ item: d }) => {
    const cfg            = STATUS[d.status] ?? STATUS.pending;
    const isPending      = d.status === 'pending';
    const attendantLabel = d.profiles?.full_name ?? d.profiles?.email?.split('@')[0] ?? 'Unknown';

    return (
      <View style={styles.card}>
        {/* Top row */}
        <View style={styles.cardTop}>
          <View style={styles.cardIconWrap}>
            <Ionicons name="cube-outline" size={18} color={Colors.navy} />
          </View>

          <View style={styles.cardInfo}>
            <Text style={styles.cardProduct} numberOfLines={1}>
              {d.products?.name ?? '—'}
            </Text>
            <Text style={styles.cardMeta}>
              {fmtDeliveryQty(d.quantity_received, d.delivery_unit, d.products?.units_per_carton)} · {attendantLabel}
            </Text>
            <Text style={styles.cardDate}>{fmtDateTime(d.created_at)}</Text>
          </View>

          {/* Status badge */}
          <View style={[styles.badge, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
            <Ionicons name={cfg.icon} size={11} color={cfg.text} />
            <Text style={[styles.badgeText, { color: cfg.text }]}>{cfg.label}</Text>
          </View>
        </View>

        {/* Note (if any) */}
        {!!d.note && (
          <View style={styles.noteRow}>
            <Ionicons name="chatbubble-outline" size={12} color={Colors.secondaryText} />
            <Text style={styles.noteText} numberOfLines={2}>{d.note}</Text>
          </View>
        )}

        {/* Rejection reason */}
        {d.status === 'rejected' && !!d.rejection_reason && (
          <View style={styles.rejectionRow}>
            <Ionicons name="alert-circle-outline" size={12} color="#B91C1C" />
            <Text style={styles.rejectionText} numberOfLines={2}>{d.rejection_reason}</Text>
          </View>
        )}

        {/* Action buttons — pending only */}
        {isPending && (
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.rejectBtn]}
              onPress={() => openRejectModal(d)}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={15} color="#B91C1C" />
              <Text style={styles.rejectBtnText}>Reject</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.approveBtn]}
              onPress={() => handleApprove(d)}
              activeOpacity={0.8}
            >
              <Ionicons name="checkmark" size={15} color={Colors.white} />
              <Text style={styles.approveBtnText}>Approve</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }, [handleApprove, openRejectModal]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Deliveries</Text>
        {filter === 'all' && pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>{pendingCount} pending</Text>
          </View>
        )}
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterTab, filter === f.key && styles.filterTabActive]}
            onPress={() => setFilter(f.key)}
            activeOpacity={0.75}
          >
            <Text style={[styles.filterLabel, filter === f.key && styles.filterLabelActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
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
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchDeliveries()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : visibleDeliveries.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="cube-outline" size={52} color={Colors.border} />
          <Text style={styles.centeredText}>
            {filter === 'all' ? 'No deliveries logged yet' : `No ${filter} deliveries`}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visibleDeliveries}
          keyExtractor={item => item.id}
          renderItem={renderDelivery}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchDeliveries(true)}
              tintColor={Colors.navy}
              colors={[Colors.navy]}
            />
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* ── Approve Modal ── */}
      <Modal
        visible={!!approveTarget}
        transparent
        animationType="fade"
        onRequestClose={closeApproveModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalIconWrap, { backgroundColor: '#D1FAE5' }]}>
                <Ionicons name="checkmark-circle-outline" size={22} color="#065F46" />
              </View>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>Approve Delivery</Text>
                <Text style={styles.modalSub} numberOfLines={1}>
                  {approveTarget?.products?.name} · {fmtDeliveryQty(approveTarget?.quantity_received, approveTarget?.delivery_unit, approveTarget?.products?.units_per_carton)}
                </Text>
              </View>
            </View>

            <Text style={styles.approveMessage}>
              Stock will be updated automatically once approved.
            </Text>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={closeApproveModal}
                disabled={approving}
                activeOpacity={0.8}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalConfirmGreen, approving && { opacity: 0.6 }]}
                onPress={confirmApprove}
                disabled={approving}
                activeOpacity={0.85}
              >
                {approving ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.modalConfirmText}>Approve</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Reject Modal ── */}
      <Modal
        visible={!!rejectTarget}
        transparent
        animationType="fade"
        onRequestClose={closeRejectModal}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            {/* Modal header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalIconWrap}>
                <Ionicons name="close-circle-outline" size={22} color="#B91C1C" />
              </View>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>Reject Delivery</Text>
                <Text style={styles.modalSub} numberOfLines={1}>
                  {rejectTarget?.products?.name} · {fmtDeliveryQty(rejectTarget?.quantity_received, rejectTarget?.delivery_unit, rejectTarget?.products?.units_per_carton)}
                </Text>
              </View>
            </View>

            <Text style={styles.modalLabel}>Reason for rejection</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Quantity mismatch, damaged goods…"
              placeholderTextColor={Colors.secondaryText}
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              autoFocus
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={closeRejectModal}
                disabled={rejecting}
                activeOpacity={0.8}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalConfirm, rejecting && { opacity: 0.6 }]}
                onPress={confirmReject}
                disabled={rejecting}
                activeOpacity={0.85}
              >
                {rejecting ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.modalConfirmText}>Reject</Text>
                )}
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

  header: {
    backgroundColor: Colors.navy,
    paddingHorizontal: 20,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: Colors.white },
  pendingBadge: {
    backgroundColor: Colors.gold,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  pendingBadgeText: { fontSize: 11, fontWeight: '700', color: Colors.navy },

  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  filterTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterTabActive: { backgroundColor: Colors.navy, borderColor: Colors.navy },
  filterLabel:     { fontSize: 11, fontWeight: '600', color: Colors.secondaryText },
  filterLabelActive: { color: Colors.white },

  listContent: { padding: 16, paddingBottom: 32, gap: 10 },

  card: {
    backgroundColor: Colors.white,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  cardIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.inputBackground,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  cardInfo:    { flex: 1 },
  cardProduct: { fontSize: 14, fontWeight: '700', color: Colors.navy, lineHeight: 20 },
  cardMeta:    { fontSize: 12, color: Colors.secondaryText, marginTop: 2 },
  cardDate:    { fontSize: 11, color: Colors.secondaryText, marginTop: 2 },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    flexShrink: 0,
    marginTop: 2,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },

  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 10,
    padding: 9,
    backgroundColor: Colors.inputBackground,
    borderRadius: 8,
  },
  noteText: { flex: 1, fontSize: 12, color: Colors.secondaryText, lineHeight: 17 },

  rejectionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 10,
    padding: 9,
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  rejectionText: { flex: 1, fontSize: 12, color: '#B91C1C', lineHeight: 17 },

  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  rejectBtn: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FEE2E2',
  },
  rejectBtnText: { fontSize: 13, fontWeight: '700', color: '#B91C1C' },
  approveBtn: {
    borderColor: Colors.navy,
    backgroundColor: Colors.navy,
  },
  approveBtnText: { fontSize: 13, fontWeight: '700', color: Colors.white },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  centeredText: { fontSize: 15, fontWeight: '600', color: Colors.navy, textAlign: 'center' },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.navy,
  },
  retryText: { fontSize: 13, fontWeight: '700', color: Colors.white },

  // ── Reject Modal ──
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
    marginBottom: 20,
  },
  modalIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  modalHeaderText: { flex: 1 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: Colors.navy },
  modalSub:   { fontSize: 12, color: Colors.secondaryText, marginTop: 2 },
  modalLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.navy,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  modalInput: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: Colors.navy,
    minHeight: 90,
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
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
    backgroundColor: '#C0392B',
  },
  modalConfirmText: { fontSize: 14, fontWeight: '700', color: Colors.white },
  modalConfirmGreen: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#16A085',
  },
  approveMessage: {
    fontSize: 13,
    color: Colors.secondaryText,
    marginBottom: 20,
    lineHeight: 19,
  },
});
