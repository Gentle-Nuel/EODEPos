import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SectionList,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
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

// Formats qty for cart display (0.5 → "½ unit", 1.5 → "1½ units", integers plain)
function fmtQty(qty, sellType) {
  const whole  = Math.floor(qty);
  const half   = qty % 1 !== 0;
  const qtyStr = half ? (whole > 0 ? `${whole}½` : '½') : String(whole);
  if (sellType === 'carton') return `${qtyStr} ctn`;
  if (half) return `${qtyStr} pack${qty >= 1 ? 's' : ''}`;
  return qtyStr;
}

const todayLabel = () =>
  new Date().toLocaleDateString('en-NG', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });

const AVATAR_PALETTE = [
  '#1B2A6B', '#C9952A', '#27AE60', '#2980B9',
  '#8E44AD', '#D35400', '#16A085', '#C0392B',
];
const avatarColor = name =>
  AVATAR_PALETTE[name.toUpperCase().charCodeAt(0) % AVATAR_PALETTE.length];

const PAYMENT_METHODS = [
  { key: 'cash',     label: 'Cash',     icon: 'cash-outline' },
  { key: 'transfer', label: 'Transfer', icon: 'swap-horizontal-outline' },
  { key: 'pos_card', label: 'POS',      icon: 'card-outline' },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function POSScreen({ navigation }) {
  const { user } = useAuth();

  const [products, setProducts]             = useState([]);
  const [loadingProducts, setLoading]       = useState(true);
  const [search, setSearch]                 = useState('');
  const [cart, setCart]                     = useState([]);      // [{product, qty, sellType}]
  const [methods, setMethods]               = useState([]);      // up to 2 method keys
  const [splitAmounts, setSplitAmounts]     = useState({});     // {key: string}
  const [isOffline, setIsOffline]           = useState(false);
  const [charging, setCharging]             = useState(false);
  const [fetchError, setFetchError]         = useState(null);
  const [typePickerProduct, setTypePickerProduct] = useState(null); // carton/unit picker

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchProducts = useCallback(async () => {
    setFetchError(null);
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, price, stock_quantity, low_stock_threshold, unit_description, image_url, units_per_carton, carton_price, allow_half')
        .order('name', { ascending: true });
      if (error) throw error;
      setProducts(data ?? []);
    } catch (err) {
      setFetchError(err.message ?? 'Could not load products. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();

    if (Platform.OS === 'web') {
      // Browser: navigator.onLine is reliable; listen for live changes
      setIsOffline(!navigator.onLine);
      const goOnline  = () => setIsOffline(false);
      const goOffline = () => setIsOffline(true);
      window.addEventListener('online',  goOnline);
      window.addEventListener('offline', goOffline);
      return () => {
        window.removeEventListener('online',  goOnline);
        window.removeEventListener('offline', goOffline);
      };
    }

    // Native (iOS / Android): NetInfo gives accurate connectivity state
    const unsub = NetInfo.addEventListener(state => {
      setIsOffline(!(state.isConnected && state.isInternetReachable !== false));
    });
    return unsub;
  }, [fetchProducts]);

  // ── Derived state ──────────────────────────────────────────────────────────

  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? products.filter(p => p.name.toLowerCase().includes(q))
      : products;

    const map = {};
    filtered.forEach(p => {
      const key = p.name[0].toUpperCase();
      if (!map[key]) map[key] = [];
      map[key].push(p);
    });
    return Object.keys(map).sort().map(title => ({ title, data: map[title] }));
  }, [products, search]);

  const cartTotal = useMemo(
    () => cart.reduce((sum, i) => {
      const price = i.sellType === 'carton' ? i.product.carton_price : i.product.price;
      return sum + price * i.qty;
    }, 0),
    [cart],
  );

  const cartCount = cart.reduce((n, i) => n + i.qty, 0);

  // ── Cart handlers ──────────────────────────────────────────────────────────

  // Returns total units already reserved in cart for a given product
  const reservedUnits = useCallback((productId) =>
    cart
      .filter(i => i.product.id === productId)
      .reduce((sum, i) => {
        const upc = i.product.units_per_carton ?? 1;
        return sum + (i.sellType === 'carton' ? i.qty * upc : i.qty);
      }, 0),
  [cart]);

  const addToCart = useCallback((product, sellType) => {
    setCart(prev => {
      const hit  = prev.find(i => i.product.id === product.id && i.sellType === sellType);
      const step = (sellType === 'unit' && product.allow_half) ? 0.5 : 1;
      const addUnits = sellType === 'carton' ? (product.units_per_carton ?? 1) : step;

      // Compute currently reserved units across all sell types for this product
      const reserved = prev
        .filter(i => i.product.id === product.id)
        .reduce((sum, i) => {
          const upc = i.product.units_per_carton ?? 1;
          return sum + (i.sellType === 'carton' ? i.qty * upc : i.qty);
        }, 0);

      if (reserved + addUnits > product.stock_quantity) return prev;

      if (hit) {
        return prev.map(i =>
          (i.product.id === product.id && i.sellType === sellType)
            ? { ...i, qty: i.qty + step }
            : i,
        );
      }
      return [...prev, { product, qty: step, sellType }];
    });
  }, []);

  const changeQty = useCallback((productId, sellType, delta) => {
    setCart(prev =>
      prev
        .map(i => {
          if (i.product.id !== productId || i.sellType !== sellType) return i;
          const step = (i.product.allow_half && sellType !== 'carton') ? 0.5 : 1;
          return { ...i, qty: i.qty + delta * step };
        })
        .filter(i => i.qty > 0),
    );
  }, []);

  const removeFromCart = useCallback((productId, sellType) => {
    setCart(prev => prev.filter(i => !(i.product.id === productId && i.sellType === sellType)));
  }, []);

  // ── Payment handlers ───────────────────────────────────────────────────────

  const toggleMethod = useCallback(key => {
    setMethods(prev => {
      if (prev.includes(key)) {
        setSplitAmounts({});
        return prev.filter(m => m !== key);
      }
      if (prev.length < 2) return [...prev, key];
      setSplitAmounts({});
      return [prev[0], key]; // swap second slot
    });
  }, []);

  const updateSplitAmount = useCallback((key, val) => {
    setSplitAmounts(prev => ({ ...prev, [key]: val }));
  }, []);

  // ── Charge ─────────────────────────────────────────────────────────────────

  const handleCharge = useCallback(async () => {
    if (!cart.length) {
      Alert.alert('Empty Cart', 'Please add items to the cart first.');
      return;
    }
    if (!methods.length) {
      Alert.alert('No Payment Method', 'Please select at least one payment method.');
      return;
    }

    let amount1 = cartTotal;
    let amount2 = null;
    let method2 = null;

    if (methods.length === 2) {
      const a1 = parseFloat(splitAmounts[methods[0]] ?? '');
      const a2 = parseFloat(splitAmounts[methods[1]] ?? '');
      if (!a1 || !a2 || isNaN(a1) || isNaN(a2)) {
        Alert.alert('Split Payment', 'Please enter an amount for each payment method.');
        return;
      }
      if (Math.abs(a1 + a2 - cartTotal) > 1) {
        Alert.alert(
          'Amount Mismatch',
          `The two amounts must add up to ${fmt(cartTotal)}.\n\nCurrent total: ${fmt(a1 + a2)}`,
        );
        return;
      }
      amount1 = a1;
      amount2 = a2;
      method2 = methods[1];
    }

    setCharging(true);
    try {
      const { data: sale, error: saleErr } = await supabase
        .from('sales')
        .insert({
          attendant_id: user.id,
          total_amount: cartTotal,
          payment_method_1: methods[0],
          amount_1: amount1,
          payment_method_2: method2,
          amount_2: amount2,
        })
        .select('id, receipt_number')
        .single();

      if (saleErr) throw saleErr;

      const { error: itemsErr } = await supabase
        .from('sale_items')
        .insert(
          cart.map(i => {
            const price        = i.sellType === 'carton' ? i.product.carton_price : i.product.price;
            const unitsDeducted = i.sellType === 'carton'
              ? i.qty * (i.product.units_per_carton ?? 1)
              : i.qty;
            return {
              sale_id:        sale.id,
              product_id:     i.product.id,
              quantity:       i.qty,
              unit_price:     price,
              sell_type:      i.sellType,
              units_deducted: unitsDeducted,
            };
          }),
        );
      if (itemsErr) throw itemsErr;

      // Build receipt params BEFORE clearing state
      const receiptParams = {
        saleId: sale.id,
        receiptNumber: '#' + String(sale.receipt_number).padStart(4, '0'),
        timestamp: new Date().toISOString(),
        attendantName: user?.full_name ?? user?.email?.split('@')[0] ?? 'Attendant',
        items: cart.map(i => {
          const price = i.sellType === 'carton' ? i.product.carton_price : i.product.price;
          return {
            name:      i.product.name,
            qty:       i.qty,
            sellType:  i.sellType,
            unitPrice: price,
            total:     price * i.qty,
          };
        }),
        subtotal: cartTotal,
        total:    cartTotal,
        payments: method2
          ? [{ method: methods[0], amount: amount1 }, { method: method2, amount: amount2 }]
          : [{ method: methods[0], amount: cartTotal }],
      };

      // Clear cart and refresh stock
      setCart([]);
      setMethods([]);
      setSplitAmounts({});
      fetchProducts();

      // Navigate to receipt — tab bar will be hidden by the root stack push
      navigation.navigate('Receipt', receiptParams);

    } catch (err) {
      Alert.alert('Sale Failed', err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setCharging(false);
    }
  }, [cart, cartTotal, methods, splitAmounts, user, fetchProducts, navigation]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderSectionHeader = useCallback(({ section }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{section.title}</Text>
    </View>
  ), []);

  const renderProduct = useCallback(({ item: p }) => {
    const isLow  = p.stock_quantity > 0 && p.stock_quantity <= p.low_stock_threshold;
    const isOut  = p.stock_quantity <= 0;

    // Units already reserved across all cart entries for this product
    const reserved = cart
      .filter(ci => ci.product.id === p.id)
      .reduce((sum, ci) => {
        const upc = ci.product.units_per_carton ?? 1;
        return sum + (ci.sellType === 'carton' ? ci.qty * upc : ci.qty);
      }, 0);
    const remaining = p.stock_quantity - reserved;
    const canAddUnit   = remaining >= (p.allow_half ? 0.5 : 1);
    const canAddCarton = !!(p.units_per_carton) && remaining >= p.units_per_carton;
    const addDisabled  = isOut || (!canAddUnit && !canAddCarton);

    return (
      <View style={styles.productRow}>
        {/* Product avatar / thumbnail */}
        <ProductAvatar imageUrl={p.image_url} name={p.name} size={42} borderRadius={10} />

        {/* Info */}
        <View style={styles.productInfo}>
          <Text style={styles.productName}>{p.name}</Text>
          {!!p.unit_description && (
            <Text style={styles.productUnit}>{p.unit_description}</Text>
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
                <Text style={styles.outBadgeText}>Out of stock</Text>
              </View>
            )}
          </View>
        </View>

        {/* Price + add button */}
        <View style={styles.productRight}>
          <Text style={styles.productPrice}>{fmt(p.price)}</Text>
          <TouchableOpacity
            style={[styles.addBtn, addDisabled && styles.addBtnDisabled]}
            onPress={() => {
              if (addDisabled) return;
              if (p.units_per_carton) {
                setTypePickerProduct(p);
              } else {
                addToCart(p, 'unit');
              }
            }}
            disabled={addDisabled}
            activeOpacity={0.75}
          >
            <Ionicons
              name="add"
              size={18}
              color={addDisabled ? Colors.secondaryText : Colors.white}
            />
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [cart, addToCart]);

  // ── Charge button state ────────────────────────────────────────────────────

  const canCharge = cart.length > 0 && methods.length > 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style="light" />

      {/* ── Offline banner ── */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Text style={styles.offlineText}>
            No internet connection — sales are saved locally
          </Text>
        </View>
      )}

      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>New Sale</Text>
            <Text style={styles.headerDate}>{todayLabel()}</Text>
          </View>
          <View style={styles.attendantChip}>
            <Ionicons name="person-circle-outline" size={15} color={Colors.gold} />
            <Text style={styles.attendantName} numberOfLines={1}>
              {user?.full_name ?? user?.email?.split('@')[0] ?? 'Attendant'}
            </Text>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={15} color="rgba(255,255,255,0.55)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search products..."
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={15} color="rgba(255,255,255,0.55)" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Body (products + cart) ── */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Product list */}
        {loadingProducts ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.navy} />
            <Text style={styles.centeredText}>Loading products…</Text>
          </View>
        ) : fetchError ? (
          <View style={styles.centered}>
            <Ionicons name="alert-circle-outline" size={44} color="#C0392B" />
            <Text style={[styles.centeredText, { color: '#C0392B' }]}>
              {fetchError}
            </Text>
            <TouchableOpacity style={styles.retryBtn} onPress={fetchProducts}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : sections.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="search-outline" size={44} color={Colors.border} />
            <Text style={styles.centeredText}>
              {search ? `No products match "${search}"` : 'No products available'}
            </Text>
            {!search && (
              <TouchableOpacity style={styles.retryBtn} onPress={fetchProducts}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <SectionList
            style={styles.flex}
            sections={sections}
            keyExtractor={item => item.id}
            renderItem={renderProduct}
            renderSectionHeader={renderSectionHeader}
            stickySectionHeadersEnabled
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listPadding}
          />
        )}

        {/* ══════════════════════════════════════════════
            CART PANEL
        ══════════════════════════════════════════════ */}
        <View style={styles.cartPanel}>

          {cart.length === 0 ? (
            /* Empty state */
            <View style={styles.emptyCart}>
              <Ionicons name="cart-outline" size={20} color={Colors.border} />
              <Text style={styles.emptyCartText}>Add items to start a sale</Text>
            </View>
          ) : (
            <>
              {/* Cart header */}
              <View style={styles.cartHeader}>
                <Text style={styles.cartHeaderLabel}>Cart</Text>
                <View style={styles.cartCountBadge}>
                  <Text style={styles.cartCountText}>{cartCount}</Text>
                </View>
              </View>

              {/* Cart items */}
              <ScrollView
                style={styles.cartItems}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                {cart.map(item => {
                  const itemPrice = item.sellType === 'carton'
                    ? item.product.carton_price
                    : item.product.price;
                  const priceLabel = item.sellType === 'carton' ? 'per carton' : 'per unit';

                  // Units that would be consumed after adding one more step
                  const step = (item.product.allow_half && item.sellType !== 'carton') ? 0.5 : 1;
                  const stepUnits = item.sellType === 'carton'
                    ? item.product.units_per_carton ?? 1
                    : step;
                  const otherReserved = cart
                    .filter(ci => ci.product.id === item.product.id && ci.sellType !== item.sellType)
                    .reduce((sum, ci) => {
                      const upc = ci.product.units_per_carton ?? 1;
                      return sum + (ci.sellType === 'carton' ? ci.qty * upc : ci.qty);
                    }, 0);
                  const thisUnits = item.sellType === 'carton'
                    ? item.qty * (item.product.units_per_carton ?? 1)
                    : item.qty;
                  const atMax = thisUnits + otherReserved + stepUnits > item.product.stock_quantity;

                  return (
                  <View key={`${item.product.id}_${item.sellType}`} style={styles.cartItem}>
                    {/* Name + unit price */}
                    <View style={styles.cartItemInfo}>
                      <Text style={styles.cartItemName} numberOfLines={1}>
                        {item.product.name}{item.sellType === 'carton' ? ' (Carton)' : ''}
                      </Text>
                      <Text style={styles.cartItemUnit}>
                        {fmt(itemPrice)} {priceLabel}
                      </Text>
                    </View>

                    {/* Qty controls */}
                    <View style={styles.qtyRow}>
                      <TouchableOpacity
                        style={styles.qtyBtn}
                        onPress={() => changeQty(item.product.id, item.sellType, -1)}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <Ionicons name="remove" size={13} color={Colors.navy} />
                      </TouchableOpacity>
                      <Text style={styles.qtyNum}>{fmtQty(item.qty, item.sellType)}</Text>
                      <TouchableOpacity
                        style={[styles.qtyBtn, atMax && styles.qtyBtnDisabled]}
                        onPress={() => changeQty(item.product.id, item.sellType, 1)}
                        disabled={atMax}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <Ionicons
                          name="add"
                          size={13}
                          color={atMax ? Colors.border : Colors.navy}
                        />
                      </TouchableOpacity>
                    </View>

                    {/* Line total */}
                    <Text style={styles.cartItemTotal}>
                      {fmt(itemPrice * item.qty)}
                    </Text>

                    {/* Remove */}
                    <TouchableOpacity
                      style={styles.trashBtn}
                      onPress={() => removeFromCart(item.product.id, item.sellType)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="trash-outline" size={15} color="#C0392B" />
                    </TouchableOpacity>
                  </View>
                  );
                })}
              </ScrollView>

              {/* Total */}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalAmount}>{fmt(cartTotal)}</Text>
              </View>

              {/* Payment method buttons */}
              <View style={styles.methodsRow}>
                {PAYMENT_METHODS.map(m => {
                  const active = methods.includes(m.key);
                  return (
                    <TouchableOpacity
                      key={m.key}
                      style={[styles.methodBtn, active && styles.methodBtnActive]}
                      onPress={() => toggleMethod(m.key)}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name={m.icon}
                        size={13}
                        color={active ? Colors.white : Colors.secondaryText}
                      />
                      <Text style={[styles.methodLabel, active && styles.methodLabelActive]}>
                        {m.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Split payment inputs */}
              {methods.length === 2 && (
                <View style={styles.splitSection}>
                  <Text style={styles.splitHeading}>Split Payment</Text>
                  <View style={styles.splitInputsRow}>
                    {methods.map(key => {
                      const m = PAYMENT_METHODS.find(x => x.key === key);
                      return (
                        <View key={key} style={styles.splitField}>
                          <Text style={styles.splitFieldLabel}>{m.label}</Text>
                          <TextInput
                            style={styles.splitInput}
                            placeholder="₦0"
                            placeholderTextColor={Colors.secondaryText}
                            keyboardType="numeric"
                            value={splitAmounts[key] ?? ''}
                            onChangeText={v => updateSplitAmount(key, v)}
                          />
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Charge button */}
              <TouchableOpacity
                style={[
                  styles.chargeBtn,
                  (!canCharge || charging) && styles.chargeBtnDisabled,
                ]}
                onPress={handleCharge}
                disabled={!canCharge || charging}
                activeOpacity={0.88}
              >
                {charging ? (
                  <ActivityIndicator color={Colors.navy} size="small" />
                ) : (
                  <>
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={18}
                      color={canCharge ? Colors.navy : Colors.secondaryText}
                      style={{ marginRight: 8 }}
                    />
                    <Text style={[styles.chargeBtnText, !canCharge && styles.chargeBtnTextDisabled]}>
                      Charge {fmt(cartTotal)}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
        {/* ══ END CART PANEL ══ */}
      </KeyboardAvoidingView>

      {/* ── Carton / Unit type picker ── */}
      {typePickerProduct && (() => {
        const p = typePickerProduct;
        const reserved = cart
          .filter(ci => ci.product.id === p.id)
          .reduce((sum, ci) => {
            const upc = ci.product.units_per_carton ?? 1;
            return sum + (ci.sellType === 'carton' ? ci.qty * upc : ci.qty);
          }, 0);
        const remaining    = p.stock_quantity - reserved;
        const canCarton    = remaining >= (p.units_per_carton ?? 1);
        const canUnit      = remaining >= (p.allow_half ? 0.5 : 1);
        return (
          <Modal
            visible
            transparent
            animationType="fade"
            onRequestClose={() => setTypePickerProduct(null)}
          >
            <TouchableOpacity
              style={styles.pickerOverlay}
              onPress={() => setTypePickerProduct(null)}
              activeOpacity={1}
            >
              <View style={styles.pickerSheet}>
                <Text style={styles.pickerTitle}>{p.name}</Text>

                {/* Carton option */}
                <TouchableOpacity
                  style={[styles.pickerOption, !canCarton && styles.pickerOptionDisabled]}
                  onPress={() => { addToCart(p, 'carton'); setTypePickerProduct(null); }}
                  disabled={!canCarton}
                  activeOpacity={0.8}
                >
                  <View style={styles.pickerOptionInfo}>
                    <Text style={[styles.pickerOptionLabel, !canCarton && styles.pickerOptionLabelDim]}>
                      Carton
                    </Text>
                    <Text style={styles.pickerOptionSub}>
                      {p.units_per_carton} units · {fmt(p.carton_price)}
                    </Text>
                  </View>
                  <Ionicons name="cube-outline" size={18} color={canCarton ? Colors.navy : Colors.border} />
                </TouchableOpacity>

                {/* Unit option */}
                <TouchableOpacity
                  style={[styles.pickerOption, !canUnit && styles.pickerOptionDisabled]}
                  onPress={() => { addToCart(p, 'unit'); setTypePickerProduct(null); }}
                  disabled={!canUnit}
                  activeOpacity={0.8}
                >
                  <View style={styles.pickerOptionInfo}>
                    <Text style={[styles.pickerOptionLabel, !canUnit && styles.pickerOptionLabelDim]}>
                      {p.allow_half ? 'Unit / Half' : 'Unit'}
                    </Text>
                    <Text style={styles.pickerOptionSub}>
                      {fmt(p.price)} per unit{p.allow_half ? ' · ½ available' : ''}
                    </Text>
                  </View>
                  <Ionicons name="wine-outline" size={18} color={canUnit ? Colors.navy : Colors.border} />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </Modal>
        );
      })()}

    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:  { flex: 1, backgroundColor: Colors.background },
  flex:  { flex: 1 },

  /* Offline banner */
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#7B1A1A',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  offlineText: {
    flex: 1,
    fontSize: 12,
    color: '#fff',
    fontWeight: '500',
  },

  /* Header */
  header: {
    backgroundColor: Colors.navy,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.white,
    letterSpacing: 0.3,
  },
  headerDate: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginTop: 2,
  },
  attendantChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    maxWidth: 150,
  },
  attendantName: {
    fontSize: 12,
    color: Colors.white,
    fontWeight: '500',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.white,
    padding: 0,
  },

  /* Section headers (alphabet dividers) */
  sectionHeader: {
    backgroundColor: Colors.background,
    paddingHorizontal: 16,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.secondaryText,
    letterSpacing: 1.5,
  },

  /* Product rows */
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarLetter: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.white,
  },
  productInfo: {
    flex: 1,
    paddingHorizontal: 12,
  },
  productName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.navy,
    lineHeight: 20,
  },
  productUnit: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginTop: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  stockText: {
    fontSize: 11,
    color: Colors.secondaryText,
  },
  lowBadge: {
    backgroundColor: '#FEF3C7',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  lowBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400E',
  },
  outBadge: {
    backgroundColor: '#FEE2E2',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  outBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B91C1C',
  },
  productRight: {
    alignItems: 'flex-end',
    gap: 6,
    flexShrink: 0,
  },
  productPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.navy,
  },
  addBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: Colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: {
    backgroundColor: Colors.inputBackground,
  },

  /* Loading / empty */
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  centeredText: {
    fontSize: 14,
    color: Colors.secondaryText,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.navy,
  },
  retryText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.white,
  },
  listPadding: { paddingBottom: 4 },

  /* ── Cart panel ── */
  cartPanel: {
    backgroundColor: Colors.white,
    borderTopWidth: 1.5,
    borderTopColor: Colors.border,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  emptyCart: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  emptyCartText: {
    fontSize: 13,
    color: Colors.secondaryText,
  },

  /* Cart header */
  cartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  cartHeaderLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.navy,
  },
  cartCountBadge: {
    backgroundColor: Colors.navy,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.white,
  },

  /* Cart items */
  cartItems: { maxHeight: 180 },
  cartItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  cartItemInfo: { flex: 1 },
  cartItemName: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.navy,
  },
  cartItemUnit: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginTop: 1,
  },

  /* Qty controls */
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBackground,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  qtyBtn: {
    width: 26,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnDisabled: { opacity: 0.35 },
  qtyNum: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.navy,
    minWidth: 22,
    textAlign: 'center',
  },
  cartItemTotal: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.navy,
    minWidth: 62,
    textAlign: 'right',
  },
  trashBtn: { padding: 2 },

  /* Total row */
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1.5,
    borderTopColor: Colors.border,
    marginTop: 4,
    marginBottom: 10,
  },
  totalLabel:  { fontSize: 15, fontWeight: '600', color: Colors.navy },
  totalAmount: { fontSize: 20, fontWeight: '800', color: Colors.navy },

  /* Payment method buttons */
  methodsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  methodBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.inputBackground,
  },
  methodBtnActive: {
    backgroundColor: Colors.navy,
    borderColor: Colors.navy,
  },
  methodLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.secondaryText,
  },
  methodLabelActive: { color: Colors.white },

  /* Split payment */
  splitSection: { marginBottom: 10 },
  splitHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.secondaryText,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  splitInputsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  splitField: { flex: 1 },
  splitFieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.navy,
    marginBottom: 5,
  },
  splitInput: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    fontWeight: '600',
    color: Colors.navy,
  },

  /* Carton / Unit type picker modal */
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  pickerSheet: {
    width: '100%',
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: 20,
    gap: 10,
  },
  pickerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.navy,
    marginBottom: 4,
    textAlign: 'center',
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.inputBackground,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  pickerOptionDisabled: { opacity: 0.42 },
  pickerOptionInfo:     { flex: 1 },
  pickerOptionLabel:    { fontSize: 15, fontWeight: '700', color: Colors.navy },
  pickerOptionLabelDim: { color: Colors.secondaryText },
  pickerOptionSub:      { fontSize: 12, color: Colors.secondaryText, marginTop: 2 },

  /* Charge button */
  chargeBtn: {
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
  chargeBtnDisabled: {
    backgroundColor: Colors.inputBackground,
    shadowOpacity: 0,
    elevation: 0,
  },
  chargeBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.navy,
    letterSpacing: 0.3,
  },
  chargeBtnTextDisabled: { color: Colors.secondaryText },
});
