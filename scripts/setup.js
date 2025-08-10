const mysql = require('mysql2/promise');
require('dotenv').config();

async function createDatabase() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
  });

  const dbName = process.env.DB_NAME || 'iot_platform';

  try {
    // Create database if not exists
    await connection.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`✅ Database '${dbName}' created or already exists`);
    
    // Switch to database
    await connection.changeUser({ database: dbName });

    // Create users table first (required for foreign keys)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        phone VARCHAR(20),
        short_id VARCHAR(16) UNIQUE,
        avatar_url VARCHAR(500),
        is_active BOOLEAN DEFAULT true,
        email_verified BOOLEAN DEFAULT false,
        email_verification_token VARCHAR(255),
        password_reset_token VARCHAR(255),
        password_reset_expires DATETIME,
        last_login DATETIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_short_id (short_id),
        INDEX idx_active (is_active),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Users table created');

    // Ensure role column exists
    await connection.execute(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS role ENUM('admin','user') NOT NULL DEFAULT 'user'
    `);
    console.log('✅ Ensured users.role column exists');

    // Create user_tokens table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS user_tokens (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        token VARCHAR(1024) NOT NULL,
        app_role VARCHAR(50) NULL,
        revoked BOOLEAN DEFAULT FALSE,
        user_agent VARCHAR(255),
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        revoked_at TIMESTAMP NULL,
        expires_at DATETIME NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id),
        INDEX idx_token (token(255)),
        INDEX idx_revoked (revoked),
        INDEX idx_expires_at (expires_at),
        INDEX idx_app_role (app_role)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ user_tokens table created');

    // Ensure app_role column exists on user_tokens
    await connection.execute(`
      ALTER TABLE user_tokens
      ADD COLUMN IF NOT EXISTS app_role VARCHAR(50) NULL AFTER token,
      ADD INDEX IF NOT EXISTS idx_app_role (app_role)
    `);
    console.log('✅ Ensured user_tokens.app_role column exists');

    // Ensure expires_at allows NULL
    await connection.execute(`
      ALTER TABLE user_tokens
      MODIFY COLUMN expires_at DATETIME NULL
    `);
    console.log('✅ Ensured user_tokens.expires_at allows NULL');

    console.log('🎉 Database setup completed successfully!');

  } catch (error) {
    console.error('❌ Database setup failed:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  createDatabase()
    .then(() => {
      console.log('✅ Setup script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Setup script failed:', error);
      process.exit(1);
    });
}

module.exports = { createDatabase };
