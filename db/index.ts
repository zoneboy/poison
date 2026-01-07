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

const connectionString = getEnv('DATABASE_URL');

if (!connectionString) {
  console.warn("DATABASE_URL is missing. The app will load but database queries will fail until you set up the environment variable.");
}

// The neon driver throws an error immediately if the connection string format is invalid.
// We provide a syntactically valid dummy string as a fallback so the UI can render.
const validFallback = 'postgresql://placeholder:placeholder@placeholder.neondatabase.app/neondb';

const sql = neon(connectionString || validFallback);
export const db = drizzle(sql, { schema });