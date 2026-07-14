// Replace both values with your Supabase project settings.
const SUPABASE_URL = "https://hgldvbpyrxdqsvwifjrw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_gtyoV3ccYS9MLMcwu-wXQw_0c73DILR";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
