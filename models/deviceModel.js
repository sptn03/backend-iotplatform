const db = require('../config/database');

const DeviceModel = {
  async getBoardsByUser(userId) {
    return db.query(`
      SELECT b.*, 
             COUNT(d.id) as device_count,
             GROUP_CONCAT(d.device_type) as device_types
      FROM esp32_boards b
      LEFT JOIN devices d ON b.board_id = d.board_id AND d.is_enabled = 1
      WHERE b.user_id = ?
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `, [userId]);
  },

  async getBoardWithDevices(boardId, userId) {
    const [board] = await db.query(`
      SELECT * FROM esp32_boards 
      WHERE board_id = ? AND user_id = ?
    `, [boardId, userId]);

    if (!board) return null;

    const devices = await db.query(`
      SELECT * FROM devices 
      WHERE board_id = ? 
      ORDER BY gpio_pin
    `, [boardId]);

    return { board, devices };
  },

  async updateBoard(boardId, userId, { name, location }) {
    const [board] = await db.query(`
      SELECT * FROM esp32_boards 
      WHERE board_id = ? AND user_id = ?
    `, [boardId, userId]);

    if (!board) return { notFound: true };
    if (!board.is_online) return { offline: true };

    await db.query(`
      UPDATE esp32_boards 
      SET name = ?, location = ?, updated_at = CURRENT_TIMESTAMP
      WHERE board_id = ?
    `, [name, location, boardId]);

    return { updated: true };
  },

  async getDevicesByUser(userId) {
    return db.query(`
      SELECT d.*, b.name as board_name, b.location as board_location, b.is_online as board_online
      FROM devices d
      JOIN esp32_boards b ON d.board_id = b.board_id
      WHERE b.user_id = ? AND d.is_enabled = 1
      ORDER BY b.name, d.gpio_pin
    `, [userId]);
  },

  async addDevice({ board_id, device_type, name, gpio_pin, config }, userId) {
    const [board] = await db.query(`
      SELECT * FROM esp32_boards 
      WHERE board_id = ? AND user_id = ?
    `, [board_id, userId]);

    if (!board) return { notFound: true };
    if (!board.is_online) return { offline: true };

    const [existingDevice] = await db.query(`
      SELECT * FROM devices 
      WHERE board_id = ? AND gpio_pin = ? AND is_enabled = 1
    `, [board_id, gpio_pin]);

    if (existingDevice) return { pinInUse: true };

    const device_id = `${board_id}_GPIO${gpio_pin}`;

    return { device_id };
  },

  async persistAddedDevice({ device_id, board_id, device_type, name, gpio_pin, config }) {
    const initialState = device_type === 'switch' ? { state: false } : {};
    await db.query(`
      INSERT INTO devices (device_id, board_id, device_type, name, gpio_pin, config, state, is_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `, [device_id, board_id, device_type, name, gpio_pin, JSON.stringify(config), JSON.stringify(initialState)]);
    return initialState;
  },

  async getDeviceWithBoard(deviceId, userId) {
    const [device] = await db.query(`
      SELECT d.*, b.user_id, b.is_online, b.board_id
      FROM devices d
      JOIN esp32_boards b ON d.board_id = b.board_id
      WHERE d.device_id = ? AND b.user_id = ?
    `, [deviceId, userId]);
    return device || null;
  },

  async updateDevice(deviceId, { name, config }) {
    await db.query(`
      UPDATE devices 
      SET name = ?, config = ?, updated_at = CURRENT_TIMESTAMP
      WHERE device_id = ?
    `, [name, JSON.stringify(config), deviceId]);
    return { updated: true };
  },

  async deleteDevice(deviceId, userId) {
    const [device] = await db.query(`
      SELECT d.*, b.user_id, b.is_online, b.board_id
      FROM devices d
      JOIN esp32_boards b ON d.board_id = b.board_id
      WHERE d.device_id = ? AND b.user_id = ?
    `, [deviceId, userId]);

    if (!device) return { notFound: true };
    if (!device.is_online) return { offline: true };

    await db.query(`
      UPDATE devices 
      SET is_enabled = 0, updated_at = CURRENT_TIMESTAMP
      WHERE device_id = ?
    `, [deviceId]);

    return { deleted: true, device };
  }
};

module.exports = DeviceModel; 