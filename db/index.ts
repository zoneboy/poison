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
if (connectionString) {
  const match = connectionString.match(/postgres(?:ql)?:\/\/[^\s|"'<>]+/);
  if (match) {
    connectionString = match[0];
  }
}

if (!connectionString) {
  console.warn("DATABASE_URL is missing.");
}

const validFallback = 'postgresql://placeholder:placeholder@placeholder.neondatabase.app/neondb';

const finalUrl = (connectionString && connectionString.startsWith('postgres')) 
  ? connectionString 
  : validFallback;

// Export raw SQL client and Drizzle instance
export const sql = neon(finalUrl);
export const db = drizzle(sql, { schema });