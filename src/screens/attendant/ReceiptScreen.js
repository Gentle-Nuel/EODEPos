import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';

const LOGO_MODULE = require('../../../assets/EODE-logo.png');
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Colors } from '../../constants/colors';
import { supabase } from '../../lib/supabase';

// ─── Fallback store info (used when settings table has no data yet) ────────────
const FALLBACK_BIZ  = 'Ebenezer-Online Digital Enterprise';
const FALLBACK_TAG  = 'Surplus Value Services & Products';

// ─── Constants ────────────────────────────────────────────────────────────────

const PAYMENT_LABELS = {
  cash:     'Cash',
  transfer: 'Bank Transfer',
  pos_card: 'POS Card',
  credit:   'Credit',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = n =>
  '₦' + Number(n).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtDate = iso =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

// Formats qty for receipt display — "2 ctn", "½ unit", "1½ units", integers plain
function fmtQty(qty, sellType) {
  const whole  = Math.floor(qty);
  const half   = qty % 1 !== 0;
  const qtyStr = half ? (whole > 0 ? `${whole}½` : '½') : String(whole);
  if (sellType === 'carton') return `${qtyStr} ctn`;
  if (half) return `${qtyStr} pack${qty >= 1 ? 's' : ''}`;
  return qtyStr;
}

const fmtTimestamp = iso => {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${date}, ${time}`;
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function DashedDivider() {
  return (
    <Text style={styles.dashed} numberOfLines={1}>
      {'- - - - - - - - - - - - - - - - - - - - - - -'}
    </Text>
  );
}

function MetaRow({ label, value }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function ActionBtn({ icon, label, onPress, disabled }) {
  return (
    <TouchableOpacity
      style={[styles.actionBtn, disabled && styles.actionBtnDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      <Ionicons
        name={icon}
        size={18}
        color={disabled ? Colors.border : Colors.navy}
      />
      <Text style={[styles.actionBtnText, disabled && styles.actionBtnTextDisabled]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── HTML generator (for print / PDF) ────────────────────────────────────────

function generateHTML({ receiptNumber, formattedDate, attendantName, items, subtotal, total, payments, logoUri, businessName, tagline, address, phone, email }) {
  const itemRows = items
    .map(i => {
      const showUnitPrice = (i.qty % 1 !== 0) && (i.sellType ?? 'unit') !== 'carton';
      return `
      <tr>
        <td class="name">${i.name}${showUnitPrice ? `<div class="unit-price">@ &#8358;${Number(i.unitPrice).toLocaleString()}/unit</div>` : ''}</td>
        <td class="qty">${fmtQty(i.qty, i.sellType ?? 'unit')}</td>
        <td class="amount">&#8358;${Number(i.total).toLocaleString()}</td>
      </tr>`;
    })
    .join('');

  const paymentRows = payments
    .map(p => `
      <tr>
        <td>${PAYMENT_LABELS[p.method] ?? p.method}</td>
        <td class="amount">&#8358;${Number(p.amount).toLocaleString()}</td>
      </tr>`)
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=320">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Courier New', Courier, monospace; font-size: 13px; color: #111; background: #fff; }
    .page { max-width: 320px; margin: 20px auto; padding: 0 24px; }

    /* Logo */
    .logo-wrap    { text-align: center; padding: 18px 0 14px; }
    .logo-img     { width: 60px; height: 60px; border-radius: 30px; object-fit: contain; }
    .biz-name     { font-size: 13px; font-weight: bold; color: #1B2A6B; margin-top: 8px; }
    .tagline      { font-size: 10px; color: #888; margin-top: 3px; }
    .store-detail { font-size: 10px; color: #888; margin-top: 2px; }

    /* Divider */
    .dashed { border-top: 1px dashed #bbb; margin: 12px 0; }

    /* Meta */
    .meta { width: 100%; font-size: 12px; border-collapse: collapse; }
    .meta td { padding: 3px 0; }
    .meta td:last-child { text-align: right; font-weight: 600; }

    /* Items */
    .items { width: 100%; border-collapse: collapse; font-size: 12px; }
    .items thead th { padding-bottom: 5px; border-bottom: 1px solid #333; text-align: left; }
    .items thead th.qty    { text-align: center; width: 36px; }
    .items thead th.amount { text-align: right;  width: 90px; }
    .items tbody td        { padding: 4px 0; vertical-align: top; }
    .items tbody td.qty    { text-align: center; }
    .items tbody td.amount { text-align: right; }
    .items tbody td.name   { padding-right: 8px; }
    .unit-price { font-size: 10px; color: #888; margin-top: 2px; }

    /* Totals */
    .totals { width: 100%; font-size: 12px; border-collapse: collapse; }
    .totals td { padding: 3px 0; }
    .totals td.amount { text-align: right; }
    .totals tr.total td { font-size: 15px; font-weight: bold; border-top: 1px solid #333; padding-top: 6px; }

    /* Payments */
    .payments { width: 100%; font-size: 12px; border-collapse: collapse; }
    .payments td { padding: 3px 0; }
    .payments td.amount { text-align: right; }
    .payments tr.balance td { font-weight: bold; border-top: 1px solid #333; padding-top: 5px; }

    /* Footer */
    .footer { text-align: center; padding: 14px 0 10px; }
    .thank-you { font-size: 14px; font-weight: bold; color: #1B2A6B; }
    .powered   { font-size: 10px; color: #aaa; margin-top: 5px; }

    /* Print — receipt paper sizing, no browser headers/footers */
    @page {
      size: 80mm auto;
      margin: 4mm;
    }
    @media print {
      body { margin: 0; padding: 0; }
      .page { max-width: 100%; margin: 0; padding: 0 12px; }
    }
  </style>
</head>
<body>
<div class="page">

  <div class="logo-wrap">
    ${logoUri ? `<img class="logo-img" src="${logoUri}" alt="Logo" />` : '<div style="width:60px;height:60px;border-radius:30px;background:#1B2A6B;display:inline-block;"></div>'}
    <div class="biz-name">${businessName}</div>
    ${tagline  ? `<div class="tagline">${tagline}</div>`           : ''}
    ${address  ? `<div class="store-detail">${address}</div>`           : ''}
    ${phone    ? `<div class="store-detail">Tel: ${phone}</div>`        : ''}
    ${email    ? `<div class="store-detail">Email: ${email}</div>`      : ''}
  </div>

  <div class="dashed"></div>

  <table class="meta">
    <tr><td>Receipt No</td><td>${receiptNumber}</td></tr>
    <tr><td>Date</td><td>${formattedDate}</td></tr>
    <tr><td>Served by</td><td>${attendantName}</td></tr>
  </table>

  <div class="dashed"></div>

  <table class="items">
    <thead>
      <tr>
        <th>Item</th>
        <th class="qty">Qty</th>
        <th class="amount">Amount</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="dashed"></div>

  <table class="totals">
    <tr>
      <td>Subtotal</td>
      <td class="amount">&#8358;${Number(subtotal).toLocaleString()}</td>
    </tr>
    <tr class="total">
      <td>TOTAL</td>
      <td class="amount">&#8358;${Number(total).toLocaleString()}</td>
    </tr>
  </table>

  <div class="dashed"></div>

  <table class="payments">
    ${paymentRows}
    <tr class="balance">
      <td>Balance</td>
      <td class="amount">&#8358;0.00</td>
    </tr>
  </table>

  <div class="dashed"></div>

  <div class="footer">
    <div class="thank-you">Thank you for your purchase!</div>
    <div class="powered">Powered by EODE POS</div>
  </div>

</div>
</body>
</html>`;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ReceiptScreen({ navigation, route }) {
  const {
    saleId        = '',
    receiptNumber = '#000000',
    timestamp     = new Date().toISOString(),
    attendantName = 'Attendant',
    items         = [],
    subtotal      = 0,
    total         = 0,
    payments      = [],
    source        = 'pos', // 'pos' | 'history'
  } = route.params ?? {};

  const [busy, setBusy]               = useState(false);
  const [logoUri, setLogoUri]         = useState(null);
  const [storeSettings, setStoreSettings] = useState(null);

  useEffect(() => {
    // Convert logo to base64 data URI — file:// URIs don't load inside expo-print's WebView
    Asset.fromModule(LOGO_MODULE).downloadAsync().then(async (asset) => {
      try {
        const uri = asset.localUri ?? asset.uri;
        if (Platform.OS === 'web') {
          // On web, fetch the asset URL and convert to data URI
          const res  = await fetch(uri);
          const blob = await res.blob();
          const reader = new FileReader();
          reader.onload = () => setLogoUri(reader.result);
          reader.readAsDataURL(blob);
        } else {
          // On native, read the local file as base64
          const b64 = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          setLogoUri(`data:image/png;base64,${b64}`);
        }
      } catch {
        setLogoUri(null); // graceful fallback — receipt renders without logo
      }
    });

    supabase
      .from('settings')
      .select('business_name, tagline, address, phone, email')
      .eq('id', 'store')
      .maybeSingle()
      .then(({ data }) => {
        if (data) setStoreSettings(data);
      });
  }, []);

  const getHTML = useCallback(() =>
    generateHTML({
      receiptNumber,
      formattedDate: fmtDate(timestamp),
      attendantName,
      items,
      subtotal,
      total,
      payments,
      logoUri,
      businessName: storeSettings?.business_name || FALLBACK_BIZ,
      tagline:      storeSettings?.tagline        || FALLBACK_TAG,
      address:      storeSettings?.address        ?? '',
      phone:        storeSettings?.phone          ?? '',
      email:        storeSettings?.email          ?? '',
    }),
  [receiptNumber, timestamp, attendantName, items, subtotal, total, payments, logoUri, storeSettings]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handlePrint = useCallback(async () => {
    setBusy(true);
    try {
      if (Platform.OS === 'web') {
        // expo-print ignores the html param on web — open a dedicated window instead
        const win = window.open('', '_blank', 'width=420,height=700');
        if (win) {
          win.document.write(getHTML());
          win.document.close();
          setTimeout(() => win.print(), 400);
        }
        setBusy(false);
        return;
      }
      await Print.printAsync({ html: getHTML() });
    } catch (e) {
      Alert.alert('Print Error', e.message ?? 'Could not open the print dialog.');
    } finally {
      setBusy(false);
    }
  }, [getHTML]);

  const handleShare = useCallback(async () => {
    setBusy(true);
    try {
      if (Platform.OS === 'web') {
        // Web Share API — opens native share sheet in supported browsers
        if (navigator.share) {
          await navigator.share({ title: `Receipt ${receiptNumber}`, text: 'Receipt from EODE POS' });
        } else {
          // Fallback: open receipt in new window so user can save/share manually
          const win = window.open('', '_blank', 'width=420,height=700');
          if (win) { win.document.write(getHTML()); win.document.close(); }
        }
        setBusy(false);
        return;
      }
      const { uri } = await Print.printToFileAsync({ html: getHTML(), base64: false });
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Receipt ${receiptNumber}`,
        UTI: 'com.adobe.pdf',
      });
    } catch (e) {
      Alert.alert('Share Error', e.message ?? 'Could not share the receipt.');
    } finally {
      setBusy(false);
    }
  }, [getHTML, receiptNumber]);

  const handleSavePDF = useCallback(async () => {
    setBusy(true);
    try {
      if (Platform.OS === 'web') {
        // On web, open receipt in a new window — user saves via browser print → Save as PDF
        const win = window.open('', '_blank', 'width=420,height=700');
        if (win) {
          win.document.write(getHTML());
          win.document.close();
          setTimeout(() => win.print(), 400);
        }
        setBusy(false);
        return;
      }
      const { uri } = await Print.printToFileAsync({ html: getHTML(), base64: false });
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Save ${receiptNumber}.pdf`,
        UTI: 'com.adobe.pdf',
      });
    } catch (e) {
      Alert.alert('Save Error', e.message ?? 'Could not save the PDF.');
    } finally {
      setBusy(false);
    }
  }, [getHTML, receiptNumber]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color={Colors.white} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Receipt</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {receiptNumber} · {fmtTimestamp(timestamp)}
          </Text>
        </View>
        {/* Spacer so title stays centered */}
        <View style={styles.backBtn} />
      </View>

      {/* ── Scrollable body ── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >

        {/* ════ RECEIPT CARD ════ */}
        <View style={styles.receiptCard}>

          {/* Top gold accent strip */}
          <View style={styles.cardAccent} />

          {/* Logo section */}
          <View style={styles.logoSection}>
            <Image source={LOGO_MODULE} style={styles.logoBadge} resizeMode="contain" />
            <Text style={styles.bizName}>
              {storeSettings?.business_name || FALLBACK_BIZ}
            </Text>
            <Text style={styles.tagline}>
              {storeSettings?.tagline || FALLBACK_TAG}
            </Text>
            {!!storeSettings?.address && (
              <Text style={styles.storeDetail}>{storeSettings.address}</Text>
            )}
            {!!storeSettings?.phone && (
              <Text style={styles.storeDetail}>Tel: {storeSettings.phone}</Text>
            )}
            {!!storeSettings?.email && (
              <Text style={styles.storeDetail}>{storeSettings.email}</Text>
            )}
          </View>

          <DashedDivider />

          {/* Meta */}
          <View style={styles.metaSection}>
            <MetaRow label="Receipt No" value={receiptNumber} />
            <MetaRow label="Date"       value={fmtDate(timestamp)} />
            <MetaRow label="Served by"  value={attendantName} />
          </View>

          <DashedDivider />

          {/* Items table */}
          <View>
            {/* Header */}
            <View style={styles.itemsHeader}>
              <Text style={[styles.colName,   styles.colHeaderText]}>Item</Text>
              <Text style={[styles.colQty,    styles.colHeaderText]}>Qty</Text>
              <Text style={[styles.colAmount, styles.colHeaderText]}>Amount</Text>
            </View>
            {/* Rows */}
            {items.map((item, idx) => (
              <View key={idx} style={styles.itemRow}>
                <View style={styles.colName}>
                  <Text style={styles.itemNameText}>{item.name}</Text>
                  {item.qty % 1 !== 0 && (item.sellType ?? 'unit') !== 'carton' && (
                    <Text style={styles.itemUnitPriceText}>@ {fmt(item.unitPrice)}/unit</Text>
                  )}
                </View>
                <Text style={[styles.colQty,    styles.itemQtyText]}>{fmtQty(item.qty, item.sellType ?? 'unit')}</Text>
                <Text style={[styles.colAmount, styles.itemAmountText]}>{fmt(item.total)}</Text>
              </View>
            ))}
          </View>

          <DashedDivider />

          {/* Subtotal + Total */}
          <View style={styles.totalsSection}>
            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>Subtotal</Text>
              <Text style={styles.subtotalValue}>{fmt(subtotal)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>TOTAL</Text>
              <Text style={styles.totalValue}>{fmt(total)}</Text>
            </View>
          </View>

          <DashedDivider />

          {/* Payment breakdown */}
          <View style={styles.paymentsSection}>
            {payments.map((p, idx) => (
              <View key={idx} style={styles.paymentRow}>
                <Text style={styles.paymentLabel}>
                  {PAYMENT_LABELS[p.method] ?? p.method}
                </Text>
                <Text style={styles.paymentValue}>{fmt(p.amount)}</Text>
              </View>
            ))}
            <View style={[styles.paymentRow, styles.balanceRow]}>
              <Text style={styles.balanceLabel}>Balance</Text>
              <Text style={styles.balanceValue}>₦0.00</Text>
            </View>
          </View>

          <DashedDivider />

          {/* Footer */}
          <View style={styles.receiptFooter}>
            <Text style={styles.thankYou}>Thank you for your purchase!</Text>
            <Text style={styles.poweredBy}>Powered by EODE POS</Text>
          </View>

        </View>
        {/* ════ END RECEIPT CARD ════ */}

        {/* Action buttons */}
        <View style={styles.actionsRow}>
          <ActionBtn
            icon="print-outline"
            label="Print"
            onPress={handlePrint}
            disabled={busy}
          />
          {/* Share button hidden — web share API only sends text; re-enable when PDF generation is added */}
          <ActionBtn
            icon="document-text-outline"
            label="Save PDF"
            onPress={handleSavePDF}
            disabled={busy}
          />
        </View>

        {busy && (
          <View style={styles.busyRow}>
            <ActivityIndicator size="small" color={Colors.navy} />
            <Text style={styles.busyText}>Processing…</Text>
          </View>
        )}

      </ScrollView>

      {/* ── Footer action ── */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.newSaleBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.88}
        >
          <Ionicons
            name={source === 'history' ? 'arrow-back-outline' : 'add-circle-outline'}
            size={18}
            color={Colors.navy}
            style={{ marginRight: 8 }}
          />
          <Text style={styles.newSaleBtnText}>
            {source === 'history' ? 'Back to History' : 'New Sale'}
          </Text>
        </TouchableOpacity>
      </View>

    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: 16, paddingBottom: 24 },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.navy,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: {
    width: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.white,
  },
  headerSub: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginTop: 2,
  },

  /* Receipt card */
  receiptCard: {
    backgroundColor: '#FAFAF8',
    marginHorizontal: 16,
    borderRadius: 10,
    overflow: 'hidden',
    shadowColor: '#1B2A6B',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.09,
    shadowRadius: 12,
    elevation: 4,
    paddingBottom: 20,
  },
  cardAccent: {
    height: 4,
    backgroundColor: Colors.gold,
  },

  /* Logo area */
  logoSection: {
    alignItems: 'center',
    paddingTop: 22,
    paddingBottom: 4,
    paddingHorizontal: 20,
  },
  logoBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: 'hidden',
    marginBottom: 10,
  },
  bizName: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.navy,
    textAlign: 'center',
    marginBottom: 3,
  },
  tagline: {
    fontSize: 11,
    color: Colors.secondaryText,
    textAlign: 'center',
  },
  storeDetail: {
    fontSize: 11,
    color: Colors.secondaryText,
    textAlign: 'center',
    marginTop: 2,
  },

  /* Dashed divider */
  dashed: {
    textAlign: 'center',
    color: '#C0C0C0',
    fontSize: 11,
    letterSpacing: 1,
    marginVertical: 12,
    paddingHorizontal: 20,
  },

  /* Meta section */
  metaSection: { paddingHorizontal: 20 },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  metaLabel: { fontSize: 12, color: Colors.secondaryText },
  metaValue: { fontSize: 12, fontWeight: '600', color: Colors.navy },

  /* Items table */
  itemsHeader: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#DEDEDE',
    marginBottom: 2,
  },
  colHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.secondaryText,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  itemRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0EE',
  },
  colName:   { flex: 1, paddingRight: 8 },
  colQty:    { width: 34, textAlign: 'center' },
  colAmount: { width: 80, textAlign: 'right' },
  itemNameText:      { fontSize: 13, color: Colors.navy, fontWeight: '500' },
  itemUnitPriceText: { fontSize: 11, color: Colors.secondaryText, marginTop: 1 },
  itemQtyText:    { fontSize: 13, color: Colors.navy, fontWeight: '600', textAlign: 'center' },
  itemAmountText: { fontSize: 13, color: Colors.navy, fontWeight: '600', textAlign: 'right' },

  /* Totals */
  totalsSection: { paddingHorizontal: 20 },
  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  subtotalLabel: { fontSize: 13, color: Colors.secondaryText },
  subtotalValue: { fontSize: 13, color: Colors.navy, fontWeight: '600' },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#DEDEDE',
  },
  totalLabel: { fontSize: 16, fontWeight: '800', color: Colors.navy },
  totalValue: { fontSize: 18, fontWeight: '800', color: Colors.navy },

  /* Payments */
  paymentsSection: { paddingHorizontal: 20 },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  paymentLabel: { fontSize: 13, color: Colors.secondaryText },
  paymentValue: { fontSize: 13, color: Colors.navy, fontWeight: '600' },
  balanceRow: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#DEDEDE',
  },
  balanceLabel: { fontSize: 13, fontWeight: '700', color: Colors.navy },
  balanceValue: { fontSize: 13, fontWeight: '700', color: Colors.navy },

  /* Receipt footer */
  receiptFooter: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  thankYou: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.navy,
    marginBottom: 4,
  },
  poweredBy: {
    fontSize: 11,
    color: Colors.secondaryText,
  },

  /* Action buttons row */
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
    marginHorizontal: 16,
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  actionBtnDisabled: {
    borderColor: Colors.border,
    backgroundColor: Colors.inputBackground,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.navy,
  },
  actionBtnTextDisabled: {
    color: Colors.border,
  },

  /* Busy indicator */
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  busyText: {
    fontSize: 12,
    color: Colors.secondaryText,
  },

  /* Footer / New Sale button */
  footer: {
    backgroundColor: Colors.white,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  newSaleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.gold,
    borderRadius: 13,
    height: 52,
    shadowColor: Colors.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  newSaleBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.navy,
    letterSpacing: 0.3,
  },
});
