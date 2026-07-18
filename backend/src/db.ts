import { Pool, PoolConfig } from "pg";

const connectionString = process.env.DATABASE_URL;

// Railway's public Postgres proxy (and most managed providers) require SSL,
// while connections over Railway's private network do not. Enable SSL when
// PGSSL=true or when the connection string clearly points at a public host.
const shouldUseSSL =
  process.env.PGSSL === "true" ||
  (!!connectionString &&
    !/localhost|127\.0\.0\.1|\.railway\.internal/.test(connectionString) &&
    process.env.PGSSL !== "false");

const config: PoolConfig = {
  connectionString,
  ...(shouldUseSSL ? { ssl: { rejectUnauthorized: false } } : {}),
};

export const pool = new Pool(config);
