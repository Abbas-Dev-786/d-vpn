import "dotenv/config";
import pg from "pg";

const { Client } = pg;

async function checkAndCreate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const url = new URL(connectionString);
  const dbName = url.pathname.slice(1);
  
  // Connect to 'postgres' database to check/create the target database
  const postgresUrl = new URL(connectionString);
  postgresUrl.pathname = "/postgres";
  
  const client = new Client({ connectionString: postgresUrl.toString() });

  try {
    await client.connect();
    console.log("Connected to postgres server.");

    const res = await client.query(`SELECT 1 FROM pg_database WHERE datname = '${dbName}'`);
    if (res.rowCount === 0) {
      console.log(`Database ${dbName} does not exist. Creating...`);
      await client.query(`CREATE DATABASE ${dbName}`);
      console.log(`Database ${dbName} created successfully.`);
    } else {
      console.log(`Database ${dbName} already exists.`);
    }
  } catch (err) {
    console.error("Failed to connect or create database:", err.message);
  } finally {
    await client.end();
  }
}

checkAndCreate();
