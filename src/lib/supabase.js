import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = 'https://eqfjphvzeeugoycaobfc.supabase.co';

const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxZmpwaHZ6ZWV1Z295Y2FvYmZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NDE1NTEsImV4cCI6MjA5NjExNzU1MX0.WLfH0VdbZYnxwrvIYUAKGmHvuUf0xCF-MN09qLGwjso';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
