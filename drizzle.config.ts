import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config();

// drizzle.config.ts
export default defineConfig({
  dialect: "postgresql",
  dbCredentials: {
    connectionString: process.env.DATABASE_URL!,
  },
});