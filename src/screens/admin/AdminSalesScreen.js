import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { supabase } from '../../lib/supabase';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = n =>
  '₦' + Number(n).toLocaleString('en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

const METHOD_LABEL = { cash: 'Cash', transfer: 'Transfer', pos_card: 'POS' };
const METHOD_ICON  = {
  cash:     'cash-outline',
  transfer: 'swap-horizontal-outline',
  pos_card: 'card-outline',
};

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-NG', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function fmtGroupDate(iso) {
  const d         = new Date(iso);
  const today     = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString())     return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-NG', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function startOfDay(date) {
  const d = new Date(date); d.setHours(0, 0, 0, 0); return d.toISOString();
}
function startOfWeek(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function startOfMonth(date) {
  const d = new Date(date); d.setDate(1); d.setHours(0, 0, 0, 0); return d.toISOString();
}

const FILTERS = [
  { key: 'today', label: 'Today'      },
  { key: 'week',  label: 'This Week'  },
  { key: 'month', label: 'This Month' },
  { key: 'all',   label: 'All Time'   },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminSalesScreen({ navigation }) {
  const [sales, setSales]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState(null);
  const [filter, setFilter]         = useState('today');

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchSales = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const now = new Date();
      let query = supabase
        .from('sales')
        .select(`
          id,
          receipt_number,
          total_amount,
          payment_method_1,
          amount_1,
          payment_method_2,
          amount_2,
          created_at,
          profiles!attendant_id ( full_name ),
          sale_items (
            quantity,
            unit_price,
            sell_type,
            products ( name )
          )
        `)
        .order('created_at', { ascending: false });

      if (filter === 'today')  query = query.gte('created_at', startOfDay(now));
      if (filter === 'week')   query = query.gte('created_at', startOfWeek(now));
      if (filter === 'month')  query = query.gte('created_at', startOfMonth(now));

      const { data, error: err } = await query;
      if (err) throw err;
      setSales(data ?? []);
    } catch (err) {
      setError(err.message ?? 'Could not load sales. Check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => { fetchSales(); }, [fetchSales]);

  // ── Open receipt ───────────────────────────────────────────────────────────

  const openReceipt = useCallback((sale) => {
    const attendantName = sale.profiles?.full_name ?? 'Attendant';

    const payments = sale.payment_method_2
      ? [
          { method: sale.payment_method_1, amount: sale.amount_1 },
          { method: sale.payment_method_2, amount: sale.amount_2 },
        ]
      : [{ method: sale.payment_method_1, amount: sale.total_amount }];

    navigation.navigate('Receipt', {
      saleId:        sale.id,
      receiptNumber: '#' + String(sale.receipt_number).padStart(4, '0'),
      timestamp:     sale.created_at,
      attendantName,
      items: (sale.sale_items ?? []).map(i => ({
        name:      i.products?.name ?? '—',
        qty:       i.quantity,
        sellType:  i.sell_type ?? 'unit',
        unitPrice: i.unit_price,
        total:     i.unit_price * i.quantity,
      })),
      subtotal: sale.total_amount,
      total:    sale.total_amount,
      payments,
      source:   'history',
    });
  }, [navigation]);

  // ── Derived totals ─────────────────────────────────────────────────────────

  const totals = useMemo(() => {
    const total    = sales.reduce((s, x) => s + (x.total_amount ?? 0), 0);
    const byMethod = {};
    sales.forEach(s => {
      if (s.payment_method_1)
        byMethod[s.payment_method_1] = (byMethod[s.payment_method_1] ?? 0) + (s.amount_1 ?? 0);
      if (s.payment_method_2)
        byMethod[s.payment_method_2] = (byMethod[s.payment_method_2] ?? 0) + (s.amount_2 ?? 0);
    });
    return { total, byMethod, count: sales.length };
  }, [sales]);

  // ── Group sales by date ────────────────────────────────────────────────────

  const grouped = useMemo(() => {
    const map = {};
    sales.forEach(s => {
      const key = fmtGroupDate(s.created_at);
      if (!map[key]) map[key] = [];
      map[key].push(s);
    });

    const result = [];
    Object.entries(map).forEach(([date, items]) => {
      result.push({ type: 'header', date, id: 'h-' + date });
      items.forEach(s => result.push({ type: 'sale', ...s }));
    });
    return result;
  }, [sales]);

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
        <Text style={styles.headerTitle}>Sales</Text>
      </View>

      {/* ── Filter tabs ── */}
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

      {/* ── Summary card — visible once data is loaded ── */}
      {!loading && !error && sales.length > 0 && (
        <View style={styles.summaryCard}>
          <View style={styles.summaryMain}>
            <Text style={styles.summaryCount}>
              {totals.count} {totals.count === 1 ? 'sale' : 'sales'}
            </Text>
            <Text style={styles.summaryTotal}>{fmt(totals.total)}</Text>
          </View>
          <View style={styles.summaryMethods}>
            {Object.entries(totals.byMethod).map(([method, amount]) => (
              <View key={method} style={styles.summaryMethodItem}>
                <Ionicons
                  name={METHOD_ICON[method] ?? 'cash-outline'}
                  size={13}
                  color={Colors.gold}
                />
                <Text style={styles.summaryMethodLabel}>
                  {METHOD_LABEL[method] ?? method}
                </Text>
                <Text style={styles.summaryMethodAmount}>{fmt(amount)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ── Body states ── */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.navy} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={44} color="#C0392B" />
          <Text style={[styles.centeredText, { color: '#C0392B' }]}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchSales()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : grouped.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="receipt-outline" size={52} color={Colors.border} />
          <Text style={styles.centeredText}>No sales found</Text>
          <Text style={styles.centeredSub}>
            {filter === 'today' ? 'No sales recorded today'
             : filter === 'week'  ? 'No sales this week'
             : filter === 'month' ? 'No sales this month'
             : 'No sales on record'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={item => item.id}
          renderItem={({ item }) =>
            item.type === 'header'
              ? <DateHeader date={item.date} />
              : <SaleCard sale={item} onPress={() => openReceipt(item)} />
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchSales(true)}
              tintColor={Colors.navy}
              colors={[Colors.navy]}
            />
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DateHeader({ date }) {
  return (
    <View style={styles.dateHeader}>
      <Text style={styles.dateHeaderText}>{date}</Text>
    </View>
  );
}

function SaleCard({ sale, onPress }) {
  const itemCount  = sale.sale_items?.length ?? 0;
  const hasSplit   = !!sale.payment_method_2;
  const attendant  = sale.profiles?.full_name ?? 'Unknown';

  return (
    <TouchableOpacity style={styles.saleCard} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.saleIconWrap}>
        <Ionicons name="receipt-outline" size={18} color={Colors.navy} />
      </View>

      <View style={styles.saleInfo}>
        <View style={styles.saleTopRow}>
          <Text style={styles.saleReceipt}>
            {'#' + String(sale.receipt_number).padStart(4, '0')}
          </Text>
          <Text style={styles.saleAttendant}>{attendant}</Text>
        </View>
        <Text style={styles.saleMeta}>
          {fmtTime(sale.created_at)} · {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </Text>
        <View style={styles.methodChips}>
          <MethodChip methodKey={sale.payment_method_1} />
          {hasSplit && <MethodChip methodKey={sale.payment_method_2} />}
        </View>
      </View>

      <View style={styles.saleRight}>
        <Text style={styles.saleTotal}>{fmt(sale.total_amount)}</Text>
        <Ionicons
          name="chevron-forward"
          size={14}
          color={Colors.secondaryText}
          style={{ marginTop: 4 }}
        />
      </View>
    </TouchableOpacity>
  );
}

function MethodChip({ methodKey }) {
  if (!methodKey) return null;
  return (
    <View style={styles.chip}>
      <Ionicons
        name={METHOD_ICON[methodKey] ?? 'cash-outline'}
        size={10}
        color={Colors.navy}
      />
      <Text style={styles.chipText}>{METHOD_LABEL[methodKey] ?? methodKey}</Text>
    </View>
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
    gap: 12,
  },
  backBtn: { width: 32, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '700', color: Colors.white },

  // ── Filter tabs ──
  filterRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
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
  filterTabActive:   { backgroundColor: Colors.navy, borderColor: Colors.navy },
  filterLabel:       { fontSize: 11, fontWeight: '600', color: Colors.secondaryText },
  filterLabelActive: { color: Colors.white },

  // ── Summary card ──
  summaryCard: {
    backgroundColor: Colors.navy,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 14,
    padding: 16,
  },
  summaryMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  summaryCount:        { fontSize: 13, fontWeight: '500', color: 'rgba(255,255,255,0.65)' },
  summaryTotal:        { fontSize: 24, fontWeight: '800', color: Colors.white },
  summaryMethods:      { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  summaryMethodItem:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  summaryMethodLabel:  { fontSize: 12, color: 'rgba(255,255,255,0.70)', fontWeight: '500' },
  summaryMethodAmount: { fontSize: 13, color: Colors.gold, fontWeight: '700' },

  // ── List ──
  listContent: { padding: 16, paddingTop: 8, paddingBottom: 32 },

  dateHeader: { paddingVertical: 8, paddingHorizontal: 2 },
  dateHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.secondaryText,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },

  saleCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  saleIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.inputBackground,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  saleInfo:      { flex: 1, paddingHorizontal: 12 },
  saleTopRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  saleReceipt:   { fontSize: 13, fontWeight: '700', color: Colors.navy },
  saleAttendant: { fontSize: 11, fontWeight: '500', color: Colors.secondaryText },
  saleMeta:      { fontSize: 11, color: Colors.secondaryText, marginBottom: 5 },
  methodChips:   { flexDirection: 'row', gap: 4 },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.inputBackground,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipText: { fontSize: 10, fontWeight: '600', color: Colors.navy },

  saleRight: { alignItems: 'flex-end', flexShrink: 0 },
  saleTotal: { fontSize: 15, fontWeight: '800', color: Colors.navy },

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
});
