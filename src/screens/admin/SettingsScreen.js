import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useAuth } from '../../lib/AuthContext';

const MENU = [
  { label: 'Store Details',      icon: 'storefront-outline',      route: 'StoreDetails' },
  { label: 'Manage Attendants',  icon: 'people-outline',          route: 'ManageAttendants' },
  { label: 'Notifications',      icon: 'notifications-outline',   route: 'Notifications' },
  { label: 'Export Data',        icon: 'download-outline',        route: 'ExportData' },
  { label: 'Admin Account',      icon: 'person-circle-outline',   route: 'AdminAccount' },
];

export default function SettingsScreen({ navigation }) {
  const { user, signOut } = useAuth();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Ionicons name="shield-checkmark" size={28} color={Colors.gold} />
        </View>
        <View>
          <Text style={styles.adminName}>{user?.full_name ?? 'Admin'}</Text>
          <Text style={styles.adminEmail}>{user?.email ?? ''}</Text>
        </View>
      </View>

      <View style={styles.menuList}>
        {MENU.map((item, i) => (
          <TouchableOpacity
            key={item.label}
            style={[styles.menuItem, i === MENU.length - 1 && { borderBottomWidth: 0 }]}
            activeOpacity={item.route ? 0.7 : 1}
            onPress={() => item.route && navigation.navigate(item.route)}
          >
            <Ionicons name={item.icon} size={20} color={item.route ? Colors.navy : Colors.border} style={{ marginRight: 14 }} />
            <Text style={[styles.menuLabel, !item.route && { color: Colors.border }]}>{item.label}</Text>
            <Ionicons name="chevron-forward" size={16} color={item.route ? Colors.border : Colors.inputBackground} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.signOutBtn} onPress={signOut} activeOpacity={0.85}>
        <Ionicons name="log-out-outline" size={17} color={Colors.white} style={{ marginRight: 8 }} />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    backgroundColor: Colors.navy,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: Colors.white },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    margin: 16,
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminName: { fontSize: 16, fontWeight: '700', color: Colors.navy },
  adminEmail: { fontSize: 13, color: Colors.secondaryText, marginTop: 2 },
  menuList: {
    backgroundColor: Colors.white,
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  menuLabel: { fontSize: 14, fontWeight: '500', color: Colors.navy },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#C0392B',
    marginHorizontal: 16,
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 13,
  },
  signOutText: { fontSize: 14, fontWeight: '700', color: Colors.white },
});
