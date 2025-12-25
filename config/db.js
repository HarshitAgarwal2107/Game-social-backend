import mongoose from "mongoose";
import pkg from "pg";
const { Pool } = pkg;

let pgPool;

const connectDB = async () => {
  try {
    // MongoDB
    const mongoConn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`✅ MongoDB connected: ${mongoConn.connection.host}`);

    // PostgreSQL
    pgPool = new Pool({
      connectionString: process.env.POSTGRES_URI,
      ssl: false
    });

    const pgClient = await pgPool.connect();
    console.log("✅ PostgreSQL connected");
    pgClient.release();
  } catch (error) {
    console.error(`❌ Database connection error: ${error.message}`);
    process.exit(1);
  }
};

export const getPG = () => pgPool;

export default connectDB;
