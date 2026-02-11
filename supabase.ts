
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase URL or Anon Key is missing in environment variables.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const checkConnection = async () => {
    try {
        const { error } = await supabase.from('cuentas').select('id').limit(1);
        if (error) {
            console.error('Supabase connection check failed:', error.message);
            return false;
        }
        console.log('Supabase connection successful');
        return true;
    } catch (err) {
        console.error('Unexpected error checking Supabase connection:', err);
        return false;
    }
};

// Auto-check on load (dev only)
if (import.meta.env.DEV) {
    checkConnection();
}
