import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// Helper to get env var safely in browser/server environments
const getEnv = (key: string) => {
  // 1. Check process.env (Node.js/Next.js environment)
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  // 2. Check localStorage (Browser-only/Sandbox environment)
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage.getItem(key);
  }
  return null;
};

let connectionString = getEnv('DATABASE_URL');

// Robust URL extraction:
// Sometimes users copy-paste entire config lines, markdown tables, or documentation.
// We try to extract a valid postgres URL from the string.
if (connectionString) {
  // Regex to find postgresql://... up to whitespace, pipe, quote, or angle bracket
  // Matches "postgres://" or "postgresql://"
  const match = connectionString.match(/postgres(?:ql)?:\/\/[^\s|"'<>]+/);
  if (match) {
    connectionString = match[0];
  }
}

if (!connectionString) {
  console.warn("DATABASE_URL is missing. The app will load but database queries will fail until you set up the environment variable.");
}

// The neon driver throws an error immediately if the connection string format is invalid.
// We provide a syntactically valid dummy string as a fallback so the UI can render.
const validFallback = 'postgresql://placeholder:placeholder@placeholder.neondatabase.app/neondb';

// Final check before passing to neon to ensure it won't crash
const finalUrl = (connectionString && connectionString.startsWith('postgres')) 
  ? connectionString 
  : validFallback;

const sql = neon(finalUrl);
export const db = drizzle(sql, { schema });