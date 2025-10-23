const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'iot_platform'
  });

  try {
    console.log('🔄 Starting database migration...');

    // Drop existing tables in correct order (child tables first)
    await connection.execute('SET FOREIGN_KEY_CHECKS = 0');
    await connection.execute('DROP TABLE IF EXISTS timers');
    await connection.execute('DROP TABLE IF EXISTS device_commands');
    await connection.execute('DROP TABLE IF EXISTS device_data');
    await connection.execute('DROP TABLE IF EXISTS device_sharing');
    await connection.execute('DROP TABLE IF EXISTS smart_home_integrations');
    await connection.execute('DROP TABLE IF EXISTS devices');
    await connection.execute('DROP TABLE IF EXISTS esp32_boards');
    // Do not drop users or user_tokens
    await connection.execute('SET FOREIGN_KEY_CHECKS = 1');
    console.log('✅ Dropped old tables');

    // Ensure users.role exists
    await connection.execute(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS role ENUM('admin','user') NOT NULL DEFAULT 'user'
    `);
    console.log('✅ Ensured users.role exists');

    // Create esp32_boards table (physical ESP32 chips)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS esp32_boards (
        id INT PRIMARY KEY AUTO_INCREMENT,
        board_id VARCHAR(50) UNIQUE NOT NULL,
        mac_address VARCHAR(17) UNIQUE,
        user_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        location VARCHAR(100),
        mqtt_topic_cmd VARCHAR(100) NOT NULL,
        mqtt_topic_resp VARCHAR(100) NOT NULL,
        is_online BOOLEAN DEFAULT FALSE,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        firmware_version VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_board_id (board_id),
        INDEX idx_user_id (user_id),
        INDEX idx_mac_address (mac_address)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Created esp32_boards table');

    // Create devices table (logical devices on GPIO pins)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS devices (
        id INT PRIMARY KEY AUTO_INCREMENT,
        device_id VARCHAR(50) NOT NULL,
        board_id VARCHAR(50) NOT NULL,
        device_type ENUM('switch', 'dimmer', 'sensor_dht22', 'sensor_ds18b20', 'sensor_analog') NOT NULL,
        name VARCHAR(100) NOT NULL,
        gpio_pin INT NOT NULL,
        config JSON,
        state JSON,
        is_enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (board_id) REFERENCES esp32_boards(board_id) ON DELETE CASCADE,
        UNIQUE KEY unique_board_gpio (board_id, gpio_pin),
        UNIQUE KEY unique_device_id (device_id),
        INDEX idx_board_id (board_id),
        INDEX idx_device_type (device_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Created devices table');

    // Create device_data table (sensor readings, state history)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS device_data (
        id INT PRIMARY KEY AUTO_INCREMENT,
        device_id VARCHAR(50) NOT NULL,
        data_type ENUM('state', 'sensor', 'heartbeat', 'error') NOT NULL,
        value JSON NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE,
        INDEX idx_device_id (device_id),
        INDEX idx_data_type (data_type),
        INDEX idx_timestamp (timestamp)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Created device_data table');

    // Create device_commands table (track commands sent to devices)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS device_commands (
        id INT PRIMARY KEY AUTO_INCREMENT,
        device_id VARCHAR(50) NOT NULL,
        command_type ENUM('control', 'config', 'add_device', 'remove_device', 'update_device') NOT NULL,
        command_data JSON NOT NULL,
        status ENUM('pending', 'sent', 'acknowledged', 'failed', 'timeout') DEFAULT 'pending',
        sent_at TIMESTAMP NULL,
        acknowledged_at TIMESTAMP NULL,
        error_message TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE,
        INDEX idx_device_id (device_id),
        INDEX idx_status (status),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Created device_commands table');

    // Create timers table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS timers (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        device_id VARCHAR(50) NOT NULL,
        name VARCHAR(100) NOT NULL,
        cron_expression VARCHAR(50) NOT NULL,
        action ENUM('turn_on', 'turn_off', 'toggle', 'set_value') NOT NULL,
        value INT,
        is_enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id),
        INDEX idx_device_id (device_id),
        INDEX idx_is_enabled (is_enabled)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Created timers table');

    // Ensure user_tokens table exists and has app_role and nullable expires_at
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
    await connection.execute(`
      ALTER TABLE user_tokens
      MODIFY COLUMN expires_at DATETIME NULL,
      ADD COLUMN IF NOT EXISTS app_role VARCHAR(50) NULL AFTER token,
      ADD INDEX IF NOT EXISTS idx_app_role (app_role)
    `);
    console.log('✅ Ensured user_tokens table and nullable expires_at and app_role column exist');

    console.log('🎉 Database migration completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  migrate().catch(console.error);
}

module.exports = migrate;
