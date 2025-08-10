const db = require('../config/database');

const UserModel = {
  async findByEmail(email) {
    return db.query('SELECT * FROM users WHERE email = ?', [email]);
  },

  async findPublicByEmail(email) {
    return db.query(
      'SELECT id, email, first_name, last_name, phone, short_id as shortId, is_active FROM users WHERE email = ?',
      [email]
    );
  },

  async findById(id) {
    return db.query('SELECT * FROM users WHERE id = ?', [id]);
  },

  async findPublicById(id) {
    return db.query(
      'SELECT id, email, first_name, last_name, phone, avatar_url, is_active, email_verified, last_login, created_at FROM users WHERE id = ?',
      [id]
    );
  },

  async existsByEmail(email) {
    const rows = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    return rows.length > 0;
  },

  async existsByShortId(shortId) {
    const rows = await db.query('SELECT id FROM users WHERE short_id = ?', [shortId]);
    return rows.length > 0;
  },

  async create({ email, password, first_name, last_name, phone, short_id }) {
    return db.query(
      'INSERT INTO users (email, password, first_name, last_name, phone, short_id) VALUES (?, ?, ?, ?, ?, ?)',
      [email, password, first_name, last_name, phone || null, short_id]
    );
  },

  async updateLastLogin(id) {
    return db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [id]);
  },

  async updatePassword(id, hashedPassword) {
    return db.query('UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?', [hashedPassword, id]);
  },

  async updateProfile(id, fields) {
    const updateFields = [];
    const updateValues = [];

    if (fields.first_name !== undefined) {
      updateFields.push('first_name = ?');
      updateValues.push(fields.first_name);
    }
    if (fields.last_name !== undefined) {
      updateFields.push('last_name = ?');
      updateValues.push(fields.last_name);
    }
    if (fields.phone !== undefined) {
      updateFields.push('phone = ?');
      updateValues.push(fields.phone);
    }

    if (updateFields.length === 0) return { affectedRows: 0 };

    updateValues.push(id);
    return db.query(`UPDATE users SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`, updateValues);
  },

  async getDashboardStats(userId) {
    const [deviceStats] = await db.query(
      `SELECT 
         COUNT(*) as total_devices,
         SUM(CASE WHEN is_online = true THEN 1 ELSE 0 END) as online_devices,
         SUM(CASE WHEN is_online = false THEN 1 ELSE 0 END) as offline_devices
       FROM devices 
       WHERE user_id = ?`,
      [userId]
    );

    const recentData = await db.query(
      `SELECT 
         d.name as device_name,
         dd.data_type,
         dd.sensor_name,
         dd.value,
         dd.unit,
         dd.timestamp
       FROM device_data dd
       JOIN devices d ON dd.device_id = d.id
       WHERE d.user_id = ?
       ORDER BY dd.timestamp DESC
       LIMIT 10`,
      [userId]
    );

    const recentCommands = await db.query(
      `SELECT 
         d.name as device_name,
         dc.command,
         dc.status,
         dc.created_at
       FROM device_commands dc
       JOIN devices d ON dc.device_id = d.id
       WHERE dc.user_id = ?
       ORDER BY dc.created_at DESC
       LIMIT 5`,
      [userId]
    );

    const integrations = await db.query(
      `SELECT platform, is_active, created_at
       FROM smart_home_integrations
       WHERE user_id = ?`,
      [userId]
    );

    return { deviceStats, recentData, recentCommands, integrations };
  }
};

module.exports = UserModel; 