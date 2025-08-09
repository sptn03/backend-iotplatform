const mysql = require('mysql2/promise');
require('dotenv').config();

function buildDbConfig() {
  const cfg = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    charset: 'utf8mb4'
  };
  const pwd = process.env.DB_PASSWORD;
  if (pwd !== undefined && pwd !== '') {
    cfg.password = pwd;
  }
  return cfg;
}

const dbConfig = buildDbConfig();

const dbName = process.env.DB_NAME || 'iot_platform';

async function createDatabase() {
  const connection = await mysql.createConnection(dbConfig);
  
  try {
    // Create database if not exists
    await connection.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`✅ Database '${dbName}' created or already exists`);
    
    // Switch to database
    await connection.changeUser({ database: dbName });
    
    // Create users table
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
        INDEX idx_active (is_active),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Users table created');

    // Ensure short_id exists (for existing installations)
    try {
      await connection.execute(`ALTER TABLE users ADD COLUMN short_id VARCHAR(16) UNIQUE`);
      console.log('✅ Users.short_id column added');
    } catch (e) {
      // Ignore if already exists
    }

    // Create devices table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS devices (
        id INT PRIMARY KEY AUTO_INCREMENT,
        device_id VARCHAR(100) UNIQUE NOT NULL,
        user_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        device_type VARCHAR(50) DEFAULT 'ESP32',
        firmware_version VARCHAR(50),
        mac_address VARCHAR(17),
        ip_address VARCHAR(15),
        location VARCHAR(255),
        room VARCHAR(100),
        is_online BOOLEAN DEFAULT false,
        last_seen DATETIME,
        mqtt_topic_cmd VARCHAR(255),
        mqtt_topic_resp VARCHAR(255),
        config JSON,
        metadata JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_device_id (device_id),
        INDEX idx_user_id (user_id),
        INDEX idx_online (is_online),
        INDEX idx_last_seen (last_seen)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Devices table created');

    // Create device_data table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS device_data (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        device_id INT NOT NULL,
        data_type VARCHAR(50) NOT NULL,
        sensor_name VARCHAR(100),
        value DECIMAL(10,4),
        unit VARCHAR(20),
        raw_data JSON,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
        INDEX idx_device_timestamp (device_id, timestamp),
        INDEX idx_data_type (data_type),
        INDEX idx_timestamp (timestamp)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Device data table created');

    // Create device_commands table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS device_commands (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        device_id INT NOT NULL,
        user_id INT NOT NULL,
        command JSON NOT NULL,
        status ENUM('pending', 'sent', 'acknowledged', 'failed') DEFAULT 'pending',
        response JSON,
        sent_at TIMESTAMP NULL,
        acknowledged_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_device_status (device_id, status),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Device commands table created');

    // Create smart_home_integrations table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS smart_home_integrations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        platform ENUM('google_home', 'alexa', 'smartthings') NOT NULL,
        platform_user_id VARCHAR(255),
        access_token TEXT,
        refresh_token TEXT,
        token_expires_at DATETIME,
        is_active BOOLEAN DEFAULT true,
        settings JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_platform (user_id, platform),
        INDEX idx_platform (platform),
        INDEX idx_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Smart home integrations table created');

    // Create device_sharing table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS device_sharing (
        id INT PRIMARY KEY AUTO_INCREMENT,
        device_id INT NOT NULL,
        owner_id INT NOT NULL,
        shared_with_id INT NOT NULL,
        permissions JSON NOT NULL,
        is_active BOOLEAN DEFAULT true,
        expires_at DATETIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (shared_with_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_device_sharing (device_id, shared_with_id),
        INDEX idx_shared_with (shared_with_id),
        INDEX idx_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Device sharing table created');

    console.log('🎉 Database migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

// Run migration
if (require.main === module) {
  createDatabase()
    .then(() => {
      console.log('✅ Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { createDatabase };
