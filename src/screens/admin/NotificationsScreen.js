import React, { useState, useCallback, useEffect } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
import { Colors } from '../../constants/colors';
import { supabase } from '../../lib/supabase';

// ─── Notification type config ─────────────────────────────────────────────────

const TYPE_CONFIG = {
  low_stock:        { icon: 'warning-outline',           color: '#D97706', bg: '#FEF3C7' },
  out_of_stock:     { icon: 'alert-circle-outline',      color: '#C0392B', bg: '#FEE2E2' },
  delivery_request: { icon: 'car-outline',               color: '#2980B9', bg: '#EFF6FF' },
  daily_summary:    { icon: 'bar-chart-outline',         color: '#27AE60', bg: '#D1FAE5' },
};

const TYPE_LABEL = {
  low_stock:        'Low Stock',
  out_of_stock:     'Out of Stock',
  delivery_request: 'Delivery',
  daily_summary:    'Summary',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtRelative(iso) {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 1)  return 'Just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  === 1) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NotificationsScreen({ navigation }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading]             = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [error, setError]                 = useState(null);
  const [filter, setFilter]               = useState('all'); // 'all' | 'unread'

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchNotifications = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const { data, error: err } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false });

      if (err) throw err;
      setNotifications(data ?? []);
    } catch (err) {
      setError(err.message ?? 'Could not load notifications.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refresh on every screen focus AND when filter changes
  useFocusEffect(
    useCallback(() => {
      fetchNotifications();
    }, [fetchNotifications]),
  );

  // ── Actions ────────────────────────────────────────────────────────────────

  const markRead = useCallback(async (id) => {
    // Optimistic update
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    await supabase.from('notifications').update({ read: true }).eq('id', id);
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    await supabase.from('notifications').update({ read: true }).eq('read', false);
  }, []);

  const deleteNotif = useCallback(async (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    await supabase.from('notifications').delete().eq('id', id);
  }, []);

  // ── Derived ────────────────────────────────────────────────────────────────

  const unreadCount = notifications.filter(n => !n.read).length;
  const displayed   = filter === 'unread'
    ? notifications.filter(n => !n.read)
    : notifications;

  // ── Render item ────────────────────────────────────────────────────────────

  const renderItem = useCallback(({ item: n }) => {
    const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.daily_summary;
    return (
      <TouchableOpacity
        style={[styles.card, !n.read && styles.cardUnread]}
        onPress={() => { if (!n.read) markRead(n.id); }}
        activeOpacity={0.78}
      >
        {/* Left: type icon */}
        <View style={[styles.iconWrap, { backgroundColor: cfg.bg }]}>
          <Ionicons name={cfg.icon} size={20} color={cfg.color} />
        </View>

        {/* Centre: content */}
        <View style={styles.cardContent}>
          <View style={styles.cardTopRow}>
            <Text style={styles.cardType}>{TYPE_LABEL[n.type] ?? n.type}</Text>
            <Text style={styles.cardTime}>{fmtRelative(n.created_at)}</Text>
          </View>
          <Text style={[styles.cardTitle, !n.read && styles.cardTitleUnread]} numberOfLines={1}>
            {n.title}
          </Text>
          <Text style={styles.cardBody} numberOfLines={2}>{n.body}</Text>
        </View>

        {/* Right: unread dot + delete */}
        <View style={styles.cardRight}>
          {!n.read && <View style={styles.unreadDot} />}
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => deleteNotif(n.id)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close-outline" size={18} color={Colors.border} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  }, [markRead, deleteNotif]);

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
        <Text style={styles.headerTitle}>Notifications</Text>
        <TouchableOpacity
          style={styles.markAllBtn}
          onPress={markAllRead}
          disabled={unreadCount === 0}
          activeOpacity={0.7}
        >
          <Text style={[styles.markAllText, unreadCount === 0 && styles.markAllTextDisabled]}>
            Mark all read
          </Text>
        </TouchableOpacity>
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {[
          { key: 'all',    label: 'All' },
          { key: 'unread', label: `Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}` },
        ].map(f => (
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

      {/* Body */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.navy} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={44} color="#C0392B" />
          <Text style={[styles.centeredText, { color: '#C0392B' }]}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchNotifications()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : displayed.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="notifications-off-outline" size={52} color={Colors.border} />
          <Text style={styles.centeredText}>
            {filter === 'unread' ? "You're all caught up!" : 'No notifications yet'}
          </Text>
          <Text style={styles.centeredSub}>
            {filter === 'unread'
              ? 'No unread notifications at the moment'
              : 'Low stock alerts, delivery requests and daily summaries will appear here'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchNotifications(true)}
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
  backBtn:    { width: 36, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle:{ flex: 1, fontSize: 18, fontWeight: '700', color: Colors.white, textAlign: 'center' },
  markAllBtn: { width: 80, alignItems: 'flex-end', justifyContent: 'center' },
  markAllText:{ fontSize: 12, fontWeight: '600', color: Colors.gold },
  markAllTextDisabled: { opacity: 0.35 },

  // ── Filter ──
  filterRow: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  filterTab: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterTabActive:   { backgroundColor: Colors.navy, borderColor: Colors.navy },
  filterLabel:       { fontSize: 12, fontWeight: '600', color: Colors.secondaryText },
  filterLabelActive: { color: Colors.white },

  // ── List ──
  listContent: { padding: 14, paddingBottom: 32 },

  // ── Notification card ──
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.white,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  cardUnread: {
    borderColor: '#BFDBFE',
    backgroundColor: '#F0F7FF',
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  cardContent:  { flex: 1 },
  cardTopRow:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  cardType:     { fontSize: 10, fontWeight: '700', color: Colors.secondaryText, textTransform: 'uppercase', letterSpacing: 0.6 },
  cardTime:     { fontSize: 10, color: Colors.secondaryText },
  cardTitle:    { fontSize: 13, fontWeight: '600', color: Colors.navy, marginBottom: 3 },
  cardTitleUnread: { fontWeight: '700' },
  cardBody:     { fontSize: 12, color: Colors.secondaryText, lineHeight: 17 },

  cardRight: {
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2980B9',
  },
  deleteBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Empty / error / loading ──
  centered:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  centeredText: { fontSize: 15, fontWeight: '600', color: Colors.navy, textAlign: 'center' },
  centeredSub:  { fontSize: 13, color: Colors.secondaryText, textAlign: 'center', lineHeight: 19 },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.navy,
  },
  retryText: { fontSize: 13, fontWeight: '700', color: Colors.white },
});
