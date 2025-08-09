const mysql = require('mysql2/promise');

class Database {
  constructor() {
    this.pool = null;
    const pwdEnv = process.env.DB_PASSWORD;
    const passwordOpt = (pwdEnv === undefined || pwdEnv === '') ? undefined : pwdEnv;
    this.config = {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: passwordOpt,
      database: process.env.DB_NAME || 'iot_platform',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      acquireTimeout: 60000,
      timeout: 60000,
      reconnect: true,
      charset: 'utf8mb4'
    };
  }

  async initialize() {
    try {
      this.pool = mysql.createPool(this.config);
      await this.testConnection();
      console.log('✅ Database pool created successfully');
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      throw error;
    }
  }

  async testConnection() {
    try {
      const connection = await this.pool.getConnection();
      await connection.ping();
      connection.release();
      return true;
    } catch (error) {
      console.error('❌ Database connection test failed:', error);
      throw error;
    }
  }

  async query(sql, params = []) {
    try {
      const [rows] = await this.pool.execute(sql, params);
      return rows;
    } catch (error) {
      console.error('❌ Database query failed:', error);
      console.error('SQL:', sql);
      console.error('Params:', params);
      throw error;
    }
  }

  async transaction(callback) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      console.log('✅ Database pool closed');
    }
  }
}

// Create singleton instance
const database = new Database();

// Initialize on module load
database.initialize().catch(console.error);

module.exports = database;
