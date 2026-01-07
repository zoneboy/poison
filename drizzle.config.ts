import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config();

// drizzle.config.ts
// import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});