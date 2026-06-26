import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);  // profile row from DB
  const [role, setRole]       = useState(null);  // 'admin' | 'attendant'
  const [loading, setLoading] = useState(true);

  // Fetch profile row from DB and populate context state
  const loadProfile = async (supabaseUser) => {
    if (!supabaseUser) {
      setUser(null);
      setRole(null);
      return;
    }
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, role')
        .eq('id', supabaseUser.id)
        .single();

      if (error || !profile) {
        // Profile missing — sign out cleanly so we don't get stuck
        await supabase.auth.signOut();
        setUser(null);
        setRole(null);
      } else {
        setUser(profile);
        setRole(profile.role);
      }
    } catch {
      setUser(null);
      setRole(null);
    }
  };

  useEffect(() => {
    // 1. Restore any existing session on app launch
    supabase.auth.getSession().then(({ data: { session } }) => {
      loadProfile(session?.user ?? null).finally(() => setLoading(false));
    });

    // 2. React to login / logout / token-refresh events automatically
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        loadProfile(session?.user ?? null);
      },
    );

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setRole(null);
  };

  // Re-fetches the profile row and updates context — call after editing name/email
  const refreshUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) await loadProfile(session.user);
  };

  return (
    <AuthContext.Provider value={{ user, role, loading, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
