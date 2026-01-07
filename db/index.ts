import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// Get the connection string from environment variables
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("DATABASE_URL is missing. The app will load but database queries will fail until you set up the environment variable.");
}

// The neon driver throws an error immediately if the connection string format is invalid.
// We provide a syntactically valid dummy string as a fallback so the UI can render.
// Valid format: postgresql://user:password@host/dbname
const validFallback = 'postgresql://placeholder:placeholder@placeholder.neondatabase.app/neondb';

const sql = neon(connectionString || validFallback);
export const db = drizzle(sql, { schema });