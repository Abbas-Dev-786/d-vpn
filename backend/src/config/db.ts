import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("Critical Error: DATABASE_URL environment variable is not set.");
  console.error("Please provide a valid PostgreSQL connection string in your .env file or environment.");
  process.exit(1);
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
