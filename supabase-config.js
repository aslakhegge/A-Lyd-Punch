// Supabase-tilkobling for Frilans Timeklokke.
// Den "anon"-nøkkelen under er trygg å ha i frontend-kode – den gir kun tilgang
// innenfor det Row Level Security-reglene i databasen tillater (dvs. hver bruker
// ser og endrer kun sine egne data). Ikke bruk service_role-nøkkelen her.

const SUPABASE_URL = "https://afbaprnujxgckpwdtzqh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmYmFwcm51anhnY2twd2R0enFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMDg0MTksImV4cCI6MjEwMTc4NDQxOX0.d8zL1NaEcWzii9y-6IUkWSQVr3Ti7zgdDorYF-6ZHkE";
