const express = require('express');
const DataController = require('../controllers/dataController');
const { deviceOwnerMiddleware } = require('../middleware/auth');
const db = require('../config/database');

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
router.get('/sensors/:deviceId', deviceOwnerMiddleware, DataController.getSensorData);

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
router.get('/commands/:deviceId', deviceOwnerMiddleware, DataController.getCommands);

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
router.get('/analytics/:deviceId', deviceOwnerMiddleware, DataController.getAnalytics);

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
    if (start_date) { whereClause += ' AND timestamp >= ?'; queryParams.push(start_date); }
    if (end_date) { whereClause += ' AND timestamp <= ?'; queryParams.push(end_date); }
    const data = await db.query(`
      SELECT sensor_name, value, unit, timestamp
      FROM device_data
      ${whereClause}
      ORDER BY timestamp ASC
    `, queryParams);

    let csv = 'Sensor Name,Value,Unit,Timestamp\n';
    data.forEach(row => { csv += `"${row.sensor_name}","${row.value}","${row.unit || ''}","${row.timestamp}"\n`; });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="device_${req.params.deviceId}_data.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Export data error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
