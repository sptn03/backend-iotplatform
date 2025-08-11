const db = require('../config/database');

const DataModel = {
  async getSensorData(deviceId, { limit = 100, offset = 0, sensor_name, start_date, end_date }) {
    let whereClause = 'WHERE device_id = ? AND data_type = "sensor"';
    const queryParams = [deviceId];

    if (sensor_name) {
      whereClause += ' AND sensor_name = ?';
      queryParams.push(sensor_name);
    }

    if (start_date) {
      whereClause += ' AND timestamp >= ?';
      queryParams.push(start_date);
    }

    if (end_date) {
      whereClause += ' AND timestamp <= ?';
      queryParams.push(end_date);
    }

    const limitNum = Number.isFinite(parseInt(limit, 10)) ? Math.max(1, Math.min(1000, parseInt(limit, 10))) : 100;
    const offsetNum = Number.isFinite(parseInt(offset, 10)) ? Math.max(0, parseInt(offset, 10)) : 0;

    const sensorData = await db.query(`
      SELECT 
        id, data_type, sensor_name, value, unit, raw_data, timestamp
      FROM device_data
      ${whereClause}
      ORDER BY \`timestamp\` DESC
      LIMIT ${limitNum} OFFSET ${offsetNum}
    `, queryParams);

    const countParams = queryParams.slice(0);
    const totalResult = await db.query(`
      SELECT COUNT(*) as total
      FROM device_data
      ${whereClause}
    `, countParams);

    const total = totalResult[0].total;
    return { sensorData, total };
  },

  async getCommands(deviceId, { limit = 50, offset = 0, status }) {
    let whereClause = 'WHERE device_id = ?';
    const queryParams = [deviceId];

    if (status) {
      whereClause += ' AND status = ?';
      queryParams.push(status);
    }

    const limitNum = Number.isFinite(parseInt(limit, 10)) ? Math.max(1, Math.min(1000, parseInt(limit, 10))) : 50;
    const offsetNum = Number.isFinite(parseInt(offset, 10)) ? Math.max(0, parseInt(offset, 10)) : 0;

    const commands = await db.query(`
      SELECT 
        id, command, status, response, sent_at, acknowledged_at, created_at
      FROM device_commands
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limitNum} OFFSET ${offsetNum}
    `, queryParams);

    const countParams = queryParams.slice(0);
    const totalResult = await db.query(`
      SELECT COUNT(*) as total
      FROM device_commands
      ${whereClause}
    `, countParams);

    const total = totalResult[0].total;
    return { commands, total };
  },

  async getAnalytics(deviceId, { period = 'day', sensor_name }) {
    let groupBy, dateFormat;
    switch (period) {
      case 'hour':
        groupBy = 'DATE_FORMAT(timestamp, "%Y-%m-%d %H:00:00")';
        dateFormat = '%Y-%m-%d %H:00:00';
        break;
      case 'week':
        groupBy = 'DATE_FORMAT(timestamp, "%Y-%u")';
        dateFormat = '%Y-%u';
        break;
      case 'month':
        groupBy = 'DATE_FORMAT(timestamp, "%Y-%m")';
        dateFormat = '%Y-%m';
        break;
      default:
        groupBy = 'DATE(timestamp)';
        dateFormat = '%Y-%m-%d';
    }

    let whereClause = 'WHERE device_id = ? AND data_type = "sensor"';
    const queryParams = [deviceId];

    if (sensor_name) {
      whereClause += ' AND sensor_name = ?';
      queryParams.push(sensor_name);
    }

    const analytics = await db.query(`
      SELECT 
        ${groupBy} as period,
        sensor_name,
        COUNT(*) as data_points,
        AVG(value) as avg_value,
        MIN(value) as min_value,
        MAX(value) as max_value,
        unit
      FROM device_data
      ${whereClause}
      GROUP BY ${groupBy}, sensor_name, unit
      ORDER BY period DESC
      LIMIT 30
    `, queryParams);

    const sensorSummary = await db.query(`
      SELECT 
        sensor_name,
        unit,
        COUNT(*) as total_readings,
        AVG(value) as avg_value,
        MIN(value) as min_value,
        MAX(value) as max_value,
        MIN(timestamp) as first_reading,
        MAX(timestamp) as last_reading
      FROM device_data
      ${whereClause}
      GROUP BY sensor_name, unit
    `, queryParams);

    return { analytics, sensorSummary, period };
  }
};

module.exports = DataModel; 