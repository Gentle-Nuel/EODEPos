import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';

const LOGO = require('../../../assets/EODE-logo.png');
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabase';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = n =>
  '₦' + Number(n).toLocaleString('en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

function todayStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString();
}

function yesterdayStart() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function headerDate() {
  // "Thu 8 Jun"
  return new Date()
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(',', '');
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-NG', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

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

// Payment method chip colours
const CHIP_CONFIG = {
  cash:     { bg: '#D1FAE5', text: '#065F46', label: 'Cash' },
  transfer: { bg: '#DBEAFE', text: '#1E40AF', label: 'Transfer' },
  pos_card: { bg: '#EDE9FE', text: '#5B21B6', label: 'POS' },
};
const SPLIT_CHIP = { bg: '#FEF3C7', text: '#92400E', label: 'Split' };

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DashboardScreen({ navigation }) {
  const { user } = useAuth();

  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);

  // Data
  const [todaySales, setTodaySales]               = useState([]);
  const [yesterdaySales, setYesterdaySales]       = useState([]);
  const [products, setProducts]                   = useState([]);
  const [pendingDeliveries, setPendingDeliveries] = useState([]);
  const [recentSales, setRecentSales]             = useState([]);

  // ── Generate notifications (silent — never crashes dashboard) ─────────────

  const generateNotifications = useCallback(async (productsData, pendingData, salesData) => {
    try {
      const { data: existing } = await supabase
        .from('notifications')
        .select('type, reference_id')
        .eq('read', false);

      const existingKeys = new Set(
        (existing ?? []).map(n => `${n.type}:${n.reference_id}`),
      );
      const toCreate = [];

      // Low stock
      productsData
        .filter(p => p.stock_quantity > 0 && p.stock_quantity <= (p.low_stock_threshold ?? 5))
        .forEach(p => {
          if (!existingKeys.has(`low_stock:${p.id}`)) {
            toCreate.push({
              type: 'low_stock', title: 'Low Stock Alert',
              body: `${p.name} is running low — only ${p.stock_quantity} unit${p.stock_quantity === 1 ? '' : 's'} left.`,
              reference_id: p.id,
            });
          }
        });

      // Out of stock
      productsData.filter(p => p.stock_quantity === 0).forEach(p => {
        if (!existingKeys.has(`out_of_stock:${p.id}`)) {
          toCreate.push({
            type: 'out_of_stock', title: 'Out of Stock',
            body: `${p.name} is completely out of stock. Restock as soon as possible.`,
            reference_id: p.id,
          });
        }
      });

      // Pending delivery requests
      pendingData.forEach(d => {
        if (!existingKeys.has(`delivery_request:${d.id}`)) {
          toCreate.push({
            type: 'delivery_request', title: 'Pending Delivery Request',
            body: 'A delivery request is awaiting your review and action.',
            reference_id: d.id,
          });
        }
      });

      // End-of-day summary (after 6 PM, once per day)
      const now = new Date(); const todayDate = now.toISOString().slice(0, 10);
      if (now.getHours() >= 18 && !existingKeys.has(`daily_summary:${todayDate}`)) {
        const revenue = salesData.reduce((s, x) => s + (x.total_amount ?? 0), 0);
        const txCount = salesData.length;
        toCreate.push({
          type: 'daily_summary', title: "Today's Sales Summary",
          body: txCount > 0
            ? `${txCount} sale${txCount === 1 ? '' : 's'} completed. Total revenue: ₦${Number(revenue).toLocaleString('en-NG')}.`
            : 'No sales were recorded today.',
          reference_id: todayDate,
        });
      }

      if (toCreate.length > 0) await supabase.from('notifications').insert(toCreate);
    } catch (e) {
      console.warn('[Notifications] generation error:', e.message);
    }
  }, []);

  // ── Fetch all dashboard data ───────────────────────────────────────────────

  const fetchAll = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const tStart = todayStart();
      const yStart = yesterdayStart();

      const [todayRes, yestRes, productsRes, pendingRes, recentRes, unreadRes] = await Promise.all([
        // Today's sales — include sale_items for quantity sum
        supabase.from('sales')
          .select('total_amount, payment_method_1, amount_1, payment_method_2, amount_2, sale_items(quantity)')
          .gte('created_at', tStart),

        // Yesterday's sales — for revenue/count comparison
        supabase.from('sales')
          .select('total_amount')
          .gte('created_at', yStart)
          .lt('created_at', tStart),

        // All products — low stock detection + notification generation
        supabase.from('products')
          .select('id, name, stock_quantity, low_stock_threshold'),

        // Pending deliveries — with product & attendant names for ALERTS section
        supabase.from('deliveries')
          .select('id, quantity_received, delivery_unit, products(name, units_per_carton), profiles!logged_by(full_name)')
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),

        // Recent 5 sales — receipt #, attendant, item quantities, payment
        supabase.from('sales')
          .select('id, receipt_number, total_amount, payment_method_1, payment_method_2, created_at, profiles!attendant_id(full_name), sale_items(quantity)')
          .order('created_at', { ascending: false })
          .limit(5),

        // Unread notification count for bell badge
        supabase.from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('read', false),
      ]);

      if (todayRes.error)    throw todayRes.error;
      if (yestRes.error)     throw yestRes.error;
      if (productsRes.error) throw productsRes.error;
      if (pendingRes.error)  throw pendingRes.error;
      if (recentRes.error)   throw recentRes.error;

      const productsData = productsRes.data ?? [];
      const pendingData  = pendingRes.data  ?? [];
      const todayData    = todayRes.data    ?? [];

      setTodaySales(todayData);
      setYesterdaySales(yestRes.data ?? []);
      setProducts(productsData);
      setPendingDeliveries(pendingData);
      setRecentSales(recentRes.data ?? []);
      setUnreadCount(unreadRes.count ?? 0);

      // Generate notifications silently
      await generateNotifications(productsData, pendingData, todayData);

      // Re-read unread count in case new notifications were just created
      const { count: freshCount } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('read', false);
      setUnreadCount(freshCount ?? 0);
    } catch (err) {
      setError(err.message ?? 'Could not load dashboard data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [generateNotifications]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Refresh bell badge every time admin returns to Dashboard
  useFocusEffect(
    useCallback(() => {
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('read', false)
        .then(({ count }) => setUnreadCount(count ?? 0));
    }, []),
  );

  // ── Derived stats ──────────────────────────────────────────────────────────

  const revenue          = todaySales.reduce((s, x) => s + (x.total_amount ?? 0), 0);
  const yesterdayRevenue = yesterdaySales.reduce((s, x) => s + (x.total_amount ?? 0), 0);
  const txCount          = todaySales.length;
  const yesterdayTxCount = yesterdaySales.length;
  const txDiff           = txCount - yesterdayTxCount;

  const revenueChangePct = yesterdayRevenue > 0
    ? Math.round(((revenue - yesterdayRevenue) / yesterdayRevenue) * 100)
    : null;

  const itemsSold = todaySales.reduce(
    (sum, s) => sum + (s.sale_items?.reduce((ss, i) => ss + (i.quantity ?? 0), 0) ?? 0),
    0,
  );

  const lowStockItems = products.filter(
    p => p.stock_quantity > 0 && p.stock_quantity <= (p.low_stock_threshold ?? 5),
  );
  const lowStockCount = lowStockItems.length;

  // Build alert rows: low stock first, then pending deliveries (max 5 total)
  const alertRows = [
    ...lowStockItems.slice(0, 3).map(p => ({ kind: 'lowstock', data: p })),
    ...pendingDeliveries.slice(0, 2).map(d => ({ kind: 'delivery', data: d })),
  ].slice(0, 5);

  const hasAlerts = alertRows.length > 0;
  const adminName = user?.full_name ?? user?.email?.split('@')[0] ?? 'Admin';

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerGreeting}>
            {greeting()}, {adminName.split(' ')[0]}
          </Text>
          <Text style={styles.headerSub}>EODE · {headerDate()}</Text>
        </View>
        <View style={styles.headerRight}>
          {/* Bell with unread badge */}
          <TouchableOpacity
            style={styles.bellBtn}
            onPress={() => navigation.navigate('Notifications')}
            activeOpacity={0.75}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons
              name={unreadCount > 0 ? 'notifications' : 'notifications-outline'}
              size={24}
              color={Colors.white}
            />
            {unreadCount > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          {/* App logo */}
          <Image source={LOGO} style={styles.logoBadge} resizeMode="contain" />
        </View>
      </View>

      {/* ── Body ── */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.navy} />
          <Text style={styles.centeredText}>Loading dashboard…</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={44} color="#C0392B" />
          <Text style={[styles.centeredText, { color: '#C0392B' }]}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchAll()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchAll(true)}
              tintColor={Colors.navy}
              colors={[Colors.navy]}
            />
          }
        >

          {/* ══════════════════════════════════════
              STAT GRID 2 × 2
          ══════════════════════════════════════ */}
          <View style={styles.grid}>

            {/* Card 1: Today's revenue — navy hero */}
            <View style={[styles.statCard, styles.heroCard]}>
              <Text style={styles.heroLabel}>Today's revenue</Text>
              <Text style={styles.heroValue}>{fmt(revenue)}</Text>
              {revenueChangePct !== null ? (
                <View style={styles.heroChangeRow}>
                  <Ionicons
                    name={revenueChangePct >= 0 ? 'trending-up-outline' : 'trending-down-outline'}
                    size={13}
                    color={revenueChangePct >= 0 ? '#4ADE80' : '#F87171'}
                  />
                  <Text style={[
                    styles.heroChangeTxt,
                    { color: revenueChangePct >= 0 ? '#4ADE80' : '#F87171' },
                  ]}>
                    {revenueChangePct >= 0 ? '+' : ''}{revenueChangePct}% vs yesterday
                  </Text>
                </View>
              ) : (
                <Text style={styles.heroNoData}>No data yesterday</Text>
              )}
            </View>

            {/* Card 2: Sales today */}
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Sales today</Text>
              <Text style={styles.statValue}>{txCount}</Text>
              {txDiff !== 0 ? (
                <View style={[
                  styles.diffChip,
                  { backgroundColor: txDiff > 0 ? '#D1FAE5' : '#FEE2E2' },
                ]}>
                  <Ionicons
                    name={txDiff > 0 ? 'arrow-up' : 'arrow-down'}
                    size={10}
                    color={txDiff > 0 ? '#065F46' : '#B91C1C'}
                  />
                  <Text style={[
                    styles.diffChipTxt,
                    { color: txDiff > 0 ? '#065F46' : '#B91C1C' },
                  ]}>
                    {txDiff > 0 ? '+' : ''}{txDiff} vs yesterday
                  </Text>
                </View>
              ) : (
                <Text style={styles.statSub}>same as yesterday</Text>
              )}
            </View>

            {/* Card 3: Items sold */}
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Items sold</Text>
              <Text style={styles.statValue}>{itemsSold % 1 === 0 ? itemsSold : +itemsSold.toFixed(1)}</Text>
              <Text style={styles.statSub}>across all products</Text>
            </View>

            {/* Card 4: Low stock alerts */}
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Low stock alerts</Text>
              <Text style={[styles.statValue, lowStockCount > 0 && { color: '#DC2626' }]}>
                {lowStockCount}
              </Text>
              {lowStockCount > 0 ? (
                <View style={styles.attentionChip}>
                  <Text style={styles.attentionChipTxt}>needs attention</Text>
                </View>
              ) : (
                <Text style={styles.statSub}>all good</Text>
              )}
            </View>

          </View>

          {/* ══════════════════════════════════════
              ALERTS SECTION
          ══════════════════════════════════════ */}
          {hasAlerts && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>ALERTS</Text>
                <TouchableOpacity
                  onPress={() => navigation.navigate('Notifications')}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Text style={styles.sectionAction}>View all</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.alertList}>
                {alertRows.map((row, idx) => {
                  if (row.kind === 'lowstock') {
                    const p = row.data;
                    return (
                      <AlertRow
                        key={`ls-${p.id}`}
                        icon="warning-outline"
                        iconBg="#FEF3C7"
                        iconColor="#D97706"
                        title={p.name}
                        subtitle={`Only ${p.stock_quantity} ${p.stock_quantity === 1 ? 'pack' : 'packs'} left · Low stock`}
                        actionLabel="View"
                        onAction={() => navigation.navigate('Inventory')}
                        isLast={idx === alertRows.length - 1}
                      />
                    );
                  }
                  // delivery_request
                  const d = row.data;
                  return (
                    <AlertRow
                      key={`del-${d.id}`}
                      icon="car-outline"
                      iconBg="#EFF6FF"
                      iconColor="#2980B9"
                      title={`Delivery logged by ${d.profiles?.full_name ?? 'Attendant'}`}
                      subtitle={`${d.products?.name ?? '—'} · ${fmtDeliveryQty(d.quantity_received, d.delivery_unit, d.products?.units_per_carton)}`}
                      actionLabel="Verify"
                      onAction={() => navigation.navigate('Deliveries')}
                      isLast={idx === alertRows.length - 1}
                    />
                  );
                })}
              </View>
            </View>
          )}

          {/* ══════════════════════════════════════
              RECENT SALES SECTION
          ══════════════════════════════════════ */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>RECENT SALES</Text>
            </View>

            {recentSales.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>No sales recorded today</Text>
              </View>
            ) : (
              <View style={styles.salesList}>
                {recentSales.map((sale, idx) => {
                  const isSplit  = !!sale.payment_method_2;
                  const chip     = isSplit ? SPLIT_CHIP : (CHIP_CONFIG[sale.payment_method_1] ?? CHIP_CONFIG.cash);
                  const itemQty  = sale.sale_items?.reduce((s, i) => s + (i.quantity ?? 0), 0) ?? 0;
                  const attName  = sale.profiles?.full_name ?? 'Unknown';
                  const rcptNum  = '#' + String(sale.receipt_number ?? 0).padStart(4, '0');

                  return (
                    <View
                      key={sale.id}
                      style={[
                        styles.saleRow,
                        idx === recentSales.length - 1 && { borderBottomWidth: 0 },
                      ]}
                    >
                      <View style={styles.saleLeft}>
                        <Text style={styles.saleReceipt}>{rcptNum}</Text>
                        <Text style={styles.saleMeta}>
                          {attName} · {fmtTime(sale.created_at)} · {itemQty} {itemQty === 1 ? 'item' : 'items'}
                        </Text>
                      </View>
                      <View style={styles.saleRight}>
                        <Text style={styles.saleAmount}>{fmt(sale.total_amount)}</Text>
                        <View style={[styles.methodChip, { backgroundColor: chip.bg }]}>
                          <Text style={[styles.methodChipTxt, { color: chip.text }]}>
                            {chip.label}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })}

                {/* View all footer */}
                <TouchableOpacity
                  style={styles.viewAllRow}
                  onPress={() => navigation.navigate('AdminSales')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.viewAllTxt}>View all sales →</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── AlertRow sub-component ───────────────────────────────────────────────────

function AlertRow({ icon, iconBg, iconColor, title, subtitle, actionLabel, onAction, isLast }) {
  return (
    <View style={[styles.alertRow, isLast && { borderBottomWidth: 0 }]}>
      <View style={[styles.alertIconWrap, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={styles.alertContent}>
        <Text style={styles.alertTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.alertSub} numberOfLines={1}>{subtitle}</Text>
      </View>
      <TouchableOpacity
        onPress={onAction}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.alertAction}>{actionLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // ── Header ──
  header: {
    backgroundColor: Colors.navy,
    paddingHorizontal: 20,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft:     { flex: 1 },
  headerGreeting: { fontSize: 18, fontWeight: '700', color: Colors.white },
  headerSub:      { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 3 },
  headerRight:    { flexDirection: 'row', alignItems: 'center', gap: 12 },

  bellBtn: {
    width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center',
  },
  bellBadge: {
    position: 'absolute', top: -2, right: -4,
    backgroundColor: '#E74C3C',
    borderRadius: 9, minWidth: 18, height: 18,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5, borderColor: Colors.navy,
  },
  bellBadgeText: { fontSize: 10, fontWeight: '800', color: Colors.white },

  logoBadge: {
    width: 44, height: 44,
    borderRadius: 22,
    overflow: 'hidden',
  },

  // ── Loading / error ──
  centered:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  centeredText: { fontSize: 14, color: Colors.secondaryText, textAlign: 'center' },
  retryBtn: {
    marginTop: 4, paddingHorizontal: 24, paddingVertical: 10,
    borderRadius: 10, backgroundColor: Colors.navy,
  },
  retryText: { fontSize: 13, fontWeight: '700', color: Colors.white },

  // ── Scroll ──
  scroll: { padding: 16, paddingBottom: 32 },

  // ── Stat grid ──
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    width: '47.5%',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },

  // Hero (revenue) card
  heroCard: {
    backgroundColor: Colors.navy,
    borderColor: Colors.navy,
    gap: 6,
  },
  heroLabel:     { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.6)' },
  heroValue:     { fontSize: 22, fontWeight: '800', color: Colors.white, marginTop: 2 },
  heroChangeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  heroChangeTxt: { fontSize: 11, fontWeight: '600' },
  heroNoData:    { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },

  // Regular stat cards
  statLabel: { fontSize: 12, color: Colors.secondaryText, fontWeight: '600' },
  statValue:  { fontSize: 26, fontWeight: '800', color: Colors.navy, marginTop: 2 },
  statSub:    { fontSize: 11, color: Colors.secondaryText },

  diffChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3,
    alignSelf: 'flex-start', marginTop: 2,
  },
  diffChipTxt: { fontSize: 11, fontWeight: '700' },

  attentionChip: {
    backgroundColor: '#FEE2E2',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  attentionChipTxt: { fontSize: 11, fontWeight: '700', color: '#B91C1C' },

  // ── Sections ──
  section: { marginBottom: 20 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 12, fontWeight: '700',
    color: Colors.secondaryText,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  sectionAction: { fontSize: 13, fontWeight: '600', color: Colors.gold },

  // ── Alert list ──
  alertList: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  alertIconWrap: {
    width: 38, height: 38, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  alertContent:  { flex: 1 },
  alertTitle:    { fontSize: 13, fontWeight: '700', color: Colors.navy, marginBottom: 2 },
  alertSub:      { fontSize: 11, color: Colors.secondaryText },
  alertAction:   { fontSize: 13, fontWeight: '700', color: Colors.gold, flexShrink: 0 },

  // ── Sales list ──
  salesList: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  saleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 10,
  },
  saleLeft:    { flex: 1 },
  saleReceipt: { fontSize: 13, fontWeight: '700', color: Colors.navy },
  saleMeta:    { fontSize: 11, color: Colors.secondaryText, marginTop: 2 },
  saleRight:   { alignItems: 'flex-end', gap: 5, flexShrink: 0 },
  saleAmount:  { fontSize: 14, fontWeight: '800', color: Colors.navy },
  methodChip: {
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
    alignSelf: 'flex-end',
  },
  methodChipTxt: { fontSize: 11, fontWeight: '700' },

  viewAllRow: {
    alignItems: 'center',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  viewAllTxt: { fontSize: 13, fontWeight: '600', color: Colors.gold },

  // ── Empty ──
  emptyBox: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyText: { fontSize: 13, color: Colors.secondaryText },
});
