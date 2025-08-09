const express = require('express');
const { query, param } = require('express-validator');
const db = require('../config/database');
const { deviceOwnerMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * /api/data/sensors/{deviceId}:
 *   get:
 *     summary: Get sensor data for a device
 *     tags: [Data]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: sensor_name
 *         schema:
 *           type: string
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Sensor data retrieved successfully
 */
router.get('/sensors/:deviceId', deviceOwnerMiddleware, async (req, res) => {
  try {
    const { limit = 100, offset = 0, sensor_name, start_date, end_date } = req.query;
    
    let whereClause = 'WHERE device_id = ? AND data_type = "sensor"';
    const queryParams = [req.params.deviceId];

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

    // Add pagination
    queryParams.push(parseInt(limit), parseInt(offset));

    const sensorData = await db.query(`
      SELECT 
        id, data_type, sensor_name, value, unit, raw_data, timestamp
      FROM device_data
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `, queryParams);

    // Get total count
    const countParams = queryParams.slice(0, -2); // Remove limit and offset
    const totalResult = await db.query(`
      SELECT COUNT(*) as total
      FROM device_data
      ${whereClause}
    `, countParams);

    const total = totalResult[0].total;

    res.json({
      success: true,
      data: {
        sensorData,
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: (parseInt(offset) + parseInt(limit)) < total
        }
      }
    });

  } catch (error) {
    console.error('Get sensor data error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/data/commands/{deviceId}:
 *   get:
 *     summary: Get command history for a device
 *     tags: [Data]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, sent, acknowledged, failed]
 *     responses:
 *       200:
 *         description: Command history retrieved successfully
 */
router.get('/commands/:deviceId', deviceOwnerMiddleware, async (req, res) => {
  try {
    const { limit = 50, offset = 0, status } = req.query;
    
    let whereClause = 'WHERE device_id = ?';
    const queryParams = [req.params.deviceId];

    if (status) {
      whereClause += ' AND status = ?';
      queryParams.push(status);
    }

    // Add pagination
    queryParams.push(parseInt(limit), parseInt(offset));

    const commands = await db.query(`
      SELECT 
        id, command, status, response, sent_at, acknowledged_at, created_at
      FROM device_commands
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, queryParams);

    // Get total count
    const countParams = queryParams.slice(0, -2);
    const totalResult = await db.query(`
      SELECT COUNT(*) as total
      FROM device_commands
      ${whereClause}
    `, countParams);

    const total = totalResult[0].total;

    res.json({
      success: true,
      data: {
        commands,
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: (parseInt(offset) + parseInt(limit)) < total
        }
      }
    });

  } catch (error) {
    console.error('Get command history error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/data/analytics/{deviceId}:
 *   get:
 *     summary: Get analytics data for a device
 *     tags: [Data]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [hour, day, week, month]
 *           default: day
 *       - in: query
 *         name: sensor_name
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Analytics data retrieved successfully
 */
router.get('/analytics/:deviceId', deviceOwnerMiddleware, async (req, res) => {
  try {
    const { period = 'day', sensor_name } = req.query;
    
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
      default: // day
        groupBy = 'DATE(timestamp)';
        dateFormat = '%Y-%m-%d';
    }

    let whereClause = 'WHERE device_id = ? AND data_type = "sensor"';
    const queryParams = [req.params.deviceId];

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

    // Get sensor summary
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

    res.json({
      success: true,
      data: {
        analytics,
        sensorSummary,
        period
      }
    });

  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/data/export/{deviceId}:
 *   get:
 *     summary: Export device data as CSV
 *     tags: [Data]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: data_type
 *         schema:
 *           type: string
 *           default: sensor
 *     responses:
 *       200:
 *         description: CSV data export
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 */
router.get('/export/:deviceId', deviceOwnerMiddleware, async (req, res) => {
  try {
    const { start_date, end_date, data_type = 'sensor' } = req.query;
    
    let whereClause = 'WHERE device_id = ? AND data_type = ?';
    const queryParams = [req.params.deviceId, data_type];

    if (start_date) {
      whereClause += ' AND timestamp >= ?';
      queryParams.push(start_date);
    }

    if (end_date) {
      whereClause += ' AND timestamp <= ?';
      queryParams.push(end_date);
    }

    const data = await db.query(`
      SELECT 
        sensor_name, value, unit, timestamp
      FROM device_data
      ${whereClause}
      ORDER BY timestamp ASC
    `, queryParams);

    // Convert to CSV
    let csv = 'Sensor Name,Value,Unit,Timestamp\n';
    data.forEach(row => {
      csv += `"${row.sensor_name}","${row.value}","${row.unit || ''}","${row.timestamp}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="device_${req.params.deviceId}_data.csv"`);
    res.send(csv);

  } catch (error) {
    console.error('Export data error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
