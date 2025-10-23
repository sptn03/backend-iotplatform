const db = require('../config/database');

const TimerModel = {
  async getTimersByUser(userId) {
    return db.query('SELECT * FROM timers WHERE user_id = ?', [userId]);
  },

  async getTimerById(timerId, userId) {
    const [timer] = await db.query('SELECT * FROM timers WHERE id = ? AND user_id = ?', [timerId, userId]);
    return timer;
  },

  async createTimer(timer) {
    const result = await db.query('INSERT INTO timers SET ?', timer);
    return result.insertId;
  },

  async updateTimer(timerId, timer, userId) {
    return db.query('UPDATE timers SET ? WHERE id = ? AND user_id = ?', [timer, timerId, userId]);
  },

  async deleteTimer(timerId, userId) {
    return db.query('DELETE FROM timers WHERE id = ? AND user_id = ?', [timerId, userId]);
  },

  async getAllEnabledTimers() {
    return db.query('SELECT * FROM timers WHERE is_enabled = 1');
  },

  async getDeviceForTimer(timerId) {
    const [device] = await db.query(
      `SELECT d.*, t.action, t.value
       FROM devices d
       JOIN timers t ON d.device_id = t.device_id
       WHERE t.id = ?`,
      [timerId]
    );
    return device;
  }
};

module.exports = TimerModel;
