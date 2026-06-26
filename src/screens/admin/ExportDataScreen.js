import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { Colors } from '../../constants/colors';
import { supabase } from '../../lib/supabase';

// ─── Date helpers ─────────────────────────────────────────────────────────────

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

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function escapeCsv(val) {
  const str = val == null ? '' : String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function csvRow(fields) {
  return fields.map(escapeCsv).join(',');
}

// ─── Config ───────────────────────────────────────────────────────────────────

const PERIODS = [
  { key: 'today', label: 'Today'      },
  { key: 'week',  label: 'This Week'  },
  { key: 'month', label: 'This Month' },
  { key: 'all',   label: 'All Time'   },
];

const EXPORT_TYPES = [
  {
    key:   'summary',
    icon:  'list-outline',
    title: 'Sales Summary',
    desc:  'One row per transaction — receipt no., date, time, attendant, item count, total & payment breakdown.',
  },
  {
    key:   'itemized',
    icon:  'grid-outline',
    title: 'Itemized Report',
    desc:  'One row per item sold — product name, quantity, unit price & item total alongside the sale details.',
  },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ExportDataScreen({ navigation }) {
  const [period, setPeriod]     = useState('month');
  const [exporting, setExporting] = useState(null); // 'summary' | 'itemized' | null
  const [error, setError]       = useState('');
  const [lastExport, setLastExport] = useState(null); // { type, count, time }

  // ── Build Supabase query ───────────────────────────────────────────────────

  const buildQuery = useCallback(() => {
    const now = new Date();
    let q = supabase
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
          products ( name )
        )
      `)
      .order('created_at', { ascending: false });

    if (period === 'today') q = q.gte('created_at', startOfDay(now));
    if (period === 'week')  q = q.gte('created_at', startOfWeek(now));
    if (period === 'month') q = q.gte('created_at', startOfMonth(now));

    return q;
  }, [period]);

  // ── Export handler ─────────────────────────────────────────────────────────

  const handleExport = useCallback(async (type) => {
    setExporting(type);
    setError('');

    try {
      const { data, error: err } = await buildQuery();
      if (err) throw err;

      const sales = data ?? [];

      if (sales.length === 0) {
        setError('No sales found for the selected period. Try a different date range.');
        return;
      }

      let csv = '';
      let rowCount = 0;

      if (type === 'summary') {
        // ── One row per sale ────────────────────────────────────────────────
        const header = csvRow([
          'Receipt No', 'Date', 'Time', 'Attendant',
          'Items', 'Total (N)',
          'Cash (N)', 'Transfer (N)', 'POS Card (N)',
        ]);

        const rows = sales.map(s => {
          const itemCount = (s.sale_items ?? []).reduce((sum, i) => sum + i.quantity, 0);

          // Build payment totals per method for this sale
          const pay = {};
          if (s.payment_method_1) pay[s.payment_method_1] = (pay[s.payment_method_1] ?? 0) + (s.amount_1 ?? 0);
          if (s.payment_method_2) pay[s.payment_method_2] = (pay[s.payment_method_2] ?? 0) + (s.amount_2 ?? 0);

          return csvRow([
            '#' + String(s.receipt_number).padStart(4, '0'),
            fmtDate(s.created_at),
            fmtTime(s.created_at),
            s.profiles?.full_name ?? '',
            itemCount,
            s.total_amount ?? 0,
            pay['cash']     ?? 0,
            pay['transfer'] ?? 0,
            pay['pos_card'] ?? 0,
          ]);
        });

        csv      = [header, ...rows].join('\r\n');
        rowCount = sales.length;

      } else {
        // ── One row per item ────────────────────────────────────────────────
        const header = csvRow([
          'Receipt No', 'Date', 'Time', 'Attendant',
          'Product', 'Qty', 'Unit Price (N)', 'Item Total (N)', 'Sale Total (N)',
        ]);

        const rows = [];
        sales.forEach(s => {
          const items = s.sale_items ?? [];
          items.forEach((item, idx) => {
            rows.push(csvRow([
              '#' + String(s.receipt_number).padStart(4, '0'),
              fmtDate(s.created_at),
              fmtTime(s.created_at),
              s.profiles?.full_name ?? '',
              item.products?.name ?? '',
              item.quantity,
              item.unit_price ?? 0,
              (item.unit_price ?? 0) * item.quantity,
              // Show sale total only on the first item row to avoid repetition
              idx === 0 ? (s.total_amount ?? 0) : '',
            ]));
          });
        });

        csv      = [header, ...rows].join('\r\n');
        rowCount = rows.length;
      }

      // ── Build filename ────────────────────────────────────────────────────

      const periodLabel = PERIODS.find(p => p.key === period)?.label.replace(/\s+/g, '_') ?? period;
      const typeLabel   = type === 'summary' ? 'Sales_Summary' : 'Itemized_Report';
      const dateStamp   = new Date().toISOString().slice(0, 10);
      const filename    = `EODE_POS_${typeLabel}_${periodLabel}_${dateStamp}.csv`;

      if (Platform.OS === 'web') {
        // ── Web: Blob download via hidden anchor ──────────────────────────
        // UTF-8 BOM (﻿) so Excel auto-detects encoding correctly
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        // ── Native (iOS / Android): expo-file-system + expo-sharing ──────
        // Dynamic require avoids the web global `File` constructor conflict
        const { File: ExpoFile, Paths } = require('expo-file-system');
        const expoFile = new ExpoFile(Paths.cache, filename);
        expoFile.create();
        expoFile.write(csv);

        const canShare = await Sharing.isAvailableAsync();
        if (!canShare) {
          setError('Sharing is not available on this device.');
          return;
        }

        await Sharing.shareAsync(expoFile.uri, {
          mimeType:    'text/csv',
          dialogTitle: filename,
          UTI:         'public.comma-separated-values-text',
        });
      }

      setLastExport({
        type,
        count: rowCount,
        time:  new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      });

    } catch (err) {
      setError(err.message ?? 'Export failed. Please try again.');
    } finally {
      setExporting(null);
    }
  }, [buildQuery, period]);

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
        <Text style={styles.headerTitle}>Export Data</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Date Range ── */}
        <Text style={styles.sectionLabel}>Date Range</Text>
        <View style={styles.periodRow}>
          {PERIODS.map(p => (
            <TouchableOpacity
              key={p.key}
              style={[styles.periodBtn, period === p.key && styles.periodBtnActive]}
              onPress={() => { setPeriod(p.key); setError(''); setLastExport(null); }}
              activeOpacity={0.75}
            >
              <Text style={[styles.periodLabel, period === p.key && styles.periodLabelActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Info note ── */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color={Colors.secondaryText} style={{ flexShrink: 0, marginTop: 1 }} />
          <Text style={styles.infoText}>
            Files are exported as <Text style={{ fontWeight: '700' }}>CSV</Text> — openable in Microsoft Excel, Google Sheets, or any spreadsheet app. Tap Export CSV to share via WhatsApp, Gmail, Google Drive, and more.
          </Text>
        </View>

        {/* ── Export type cards ── */}
        <Text style={styles.sectionLabel}>Export Type</Text>

        {EXPORT_TYPES.map(et => (
          <View key={et.key} style={styles.exportCard}>

            <View style={styles.exportCardTop}>
              <View style={styles.exportIconWrap}>
                <Ionicons name={et.icon} size={21} color={Colors.navy} />
              </View>
              <View style={styles.exportCardText}>
                <Text style={styles.exportTitle}>{et.title}</Text>
                <Text style={styles.exportDesc}>{et.desc}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.exportBtn, !!exporting && styles.exportBtnDisabled]}
              onPress={() => handleExport(et.key)}
              disabled={!!exporting}
              activeOpacity={0.85}
            >
              {exporting === et.key ? (
                <ActivityIndicator size="small" color={Colors.navy} />
              ) : (
                <>
                  <Ionicons name="download-outline" size={16} color={Colors.navy} style={{ marginRight: 6 }} />
                  <Text style={styles.exportBtnText}>Export CSV</Text>
                </>
              )}
            </TouchableOpacity>

          </View>
        ))}

        {/* ── Error ── */}
        {!!error && (
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle-outline" size={14} color="#C0392B" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* ── Last export success banner ── */}
        {lastExport && !error && (
          <View style={styles.successRow}>
            <Ionicons name="checkmark-circle-outline" size={14} color="#065F46" />
            <Text style={styles.successText}>
              {lastExport.type === 'summary' ? 'Sales Summary' : 'Itemized Report'} exported —{' '}
              {lastExport.count} {lastExport.count === 1 ? 'row' : 'rows'} at {lastExport.time}
            </Text>
          </View>
        )}

      </ScrollView>
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

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.navy,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 10,
  },

  // ── Period selector ──
  periodRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  periodBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  periodBtnActive:  { backgroundColor: Colors.navy, borderColor: Colors.navy },
  periodLabel:      { fontSize: 11, fontWeight: '600', color: Colors.secondaryText },
  periodLabelActive:{ color: Colors.white },

  // ── Info box ──
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.inputBackground,
    borderRadius: 11,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 24,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: Colors.secondaryText,
    lineHeight: 18,
  },

  // ── Export cards ──
  exportCard: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 18,
    marginBottom: 14,
  },
  exportCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  exportIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.inputBackground,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  exportCardText: { flex: 1 },
  exportTitle:    { fontSize: 14, fontWeight: '700', color: Colors.navy, marginBottom: 4 },
  exportDesc:     { fontSize: 12, color: Colors.secondaryText, lineHeight: 17 },

  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.gold,
    borderRadius: 11,
    height: 46,
    shadowColor: Colors.gold,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  exportBtnDisabled: { opacity: 0.55 },
  exportBtnText:     { fontSize: 14, fontWeight: '800', color: Colors.navy },

  // ── Feedback rows ──
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
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
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#34D399',
  },
  successText: { flex: 1, fontSize: 13, color: '#065F46', fontWeight: '600' },
});
