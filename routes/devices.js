const express = require('express');
const { body, validationResult, param } = require('express-validator');
const db = require('../config/database');
const { deviceOwnerMiddleware } = require('../middleware/auth');
const mqttService = require('../services/mqttService');

const router = express.Router();

// Validation rules
const deviceValidation = [
  body('device_id').trim().isLength({ min: 1 }).withMessage('Device ID is required'),
  body('name').trim().isLength({ min: 1 }).withMessage('Device name is required'),
  body('description').optional().trim(),
  body('location').optional().trim(),
  body('room').optional().trim()
];

/**
 * @swagger
 * /api/devices:
 *   get:
 *     summary: Get all user devices
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Devices retrieved successfully
 */
router.get('/', async (req, res) => {
  try {
    const devices = await db.query(`
      SELECT 
        d.*,
        CASE 
          WHEN d.user_id = ? THEN 'owner'
          ELSE 'shared'
        END as access_type,
        CASE 
          WHEN d.user_id != ? THEN ds.permissions
          ELSE NULL
        END as shared_permissions
      FROM devices d
      LEFT JOIN device_sharing ds ON d.id = ds.device_id AND ds.shared_with_id = ? AND ds.is_active = true
      WHERE d.user_id = ? OR ds.id IS NOT NULL
      ORDER BY d.created_at DESC
    `, [req.user.id, req.user.id, req.user.id, req.user.id]);

    res.json({
      success: true,
      data: {
        devices,
        total: devices.length
      }
    });

  } catch (error) {
    console.error('Get devices error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/devices/{id}:
 *   get:
 *     summary: Get device by ID
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Device retrieved successfully
 *       404:
 *         description: Device not found
 */
router.get('/:deviceId', deviceOwnerMiddleware, async (req, res) => {
  try {
    const devices = await db.query(`
      SELECT d.*, u.first_name, u.last_name, u.email as owner_email
      FROM devices d
      JOIN users u ON d.user_id = u.id
      WHERE d.id = ?
    `, [req.params.deviceId]);

    if (devices.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }

    res.json({
      success: true,
      data: {
        device: devices[0]
      }
    });

  } catch (error) {
    console.error('Get device error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/devices:
 *   post:
 *     summary: Register a new device
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - device_id
 *               - name
 *             properties:
 *               device_id:
 *                 type: string
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               location:
 *                 type: string
 *               room:
 *                 type: string
 *     responses:
 *       201:
 *         description: Device registered successfully
 *       400:
 *         description: Validation error or device already exists
 */
router.post('/', deviceValidation, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { device_id, name, description, location, room } = req.body;

    // Check if device already exists
    const existingDevices = await db.query('SELECT id FROM devices WHERE device_id = ?', [device_id]);
    if (existingDevices.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Device with this ID already exists'
      });
    }

    // Create device
    const result = await db.query(`
      INSERT INTO devices (device_id, user_id, name, description, location, room, mqtt_topic_cmd, mqtt_topic_resp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      device_id,
      req.user.id,
      name,
      description || null,
      location || null,
      room || null,
      `cmd/${device_id}`,
      `resp/${device_id}`
    ]);

    const deviceDbId = result.insertId;

    // Get created device
    const devices = await db.query('SELECT * FROM devices WHERE id = ?', [deviceDbId]);

    res.status(201).json({
      success: true,
      message: 'Device registered successfully',
      data: {
        device: devices[0]
      }
    });

  } catch (error) {
    console.error('Register device error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during device registration'
    });
  }
});

/**
 * @swagger
 * /api/devices/{id}:
 *   put:
 *     summary: Update device
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               location:
 *                 type: string
 *               room:
 *                 type: string
 *     responses:
 *       200:
 *         description: Device updated successfully
 *       404:
 *         description: Device not found
 */
router.put('/:deviceId', deviceOwnerMiddleware, async (req, res) => {
  try {
    const { name, description, location, room } = req.body;
    const updateFields = [];
    const updateValues = [];

    if (name !== undefined) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }
    if (description !== undefined) {
      updateFields.push('description = ?');
      updateValues.push(description);
    }
    if (location !== undefined) {
      updateFields.push('location = ?');
      updateValues.push(location);
    }
    if (room !== undefined) {
      updateFields.push('room = ?');
      updateValues.push(room);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    updateValues.push(req.params.deviceId);

    await db.query(
      `UPDATE devices SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`,
      updateValues
    );

    // Get updated device
    const devices = await db.query('SELECT * FROM devices WHERE id = ?', [req.params.deviceId]);

    res.json({
      success: true,
      message: 'Device updated successfully',
      data: {
        device: devices[0]
      }
    });

  } catch (error) {
    console.error('Update device error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/devices/{id}:
 *   delete:
 *     summary: Delete device
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Device deleted successfully
 *       404:
 *         description: Device not found
 */
router.delete('/:deviceId', deviceOwnerMiddleware, async (req, res) => {
  try {
    // Only device owner can delete
    if (req.device.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Only device owner can delete the device'
      });
    }

    await db.query('DELETE FROM devices WHERE id = ?', [req.params.deviceId]);

    res.json({
      success: true,
      message: 'Device deleted successfully'
    });

  } catch (error) {
    console.error('Delete device error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/devices/{id}/command:
 *   post:
 *     summary: Send command to device
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *             properties:
 *               action:
 *                 type: string
 *               pin:
 *                 type: integer
 *               state:
 *                 type: string
 *               value:
 *                 type: number
 *     responses:
 *       200:
 *         description: Command sent successfully
 *       404:
 *         description: Device not found
 */
router.post('/:deviceId/command', deviceOwnerMiddleware, async (req, res) => {
  try {
    const command = {
      ...req.body,
      userId: req.user.id,
      timestamp: new Date().toISOString()
    };

    const result = await mqttService.sendDeviceCommand(req.device.device_id, command);

    res.json({
      success: true,
      message: 'Command sent successfully',
      data: result
    });

  } catch (error) {
    console.error('Send command error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/devices/{id}/status:
 *   get:
 *     summary: Get device status and latest data
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Device status retrieved successfully
 */
router.get('/:deviceId/status', deviceOwnerMiddleware, async (req, res) => {
  try {
    // Get latest sensor data
    const sensorData = await db.query(`
      SELECT data_type, sensor_name, value, unit, timestamp
      FROM device_data
      WHERE device_id = ? AND data_type = 'sensor'
      ORDER BY timestamp DESC
      LIMIT 10
    `, [req.params.deviceId]);

    // Get recent commands
    const recentCommands = await db.query(`
      SELECT command, status, sent_at, acknowledged_at
      FROM device_commands
      WHERE device_id = ?
      ORDER BY created_at DESC
      LIMIT 5
    `, [req.params.deviceId]);

    res.json({
      success: true,
      data: {
        device: req.device,
        sensorData,
        recentCommands
      }
    });

  } catch (error) {
    console.error('Get device status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Link a device to current user by device_id or mac_address
 */
router.post('/link', [
  body('device_id').optional().isString(),
  body('mac').optional().isString().isLength({ min: 12 }).withMessage('Invalid MAC'),
  body('name').optional().isString(),
  body('location').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const { device_id, mac, name, location } = req.body;

    if (!device_id && !mac) {
      return res.status(400).json({ success: false, message: 'device_id or mac is required' });
    }

    // Find existing device by device_id or mac
    let devices = [];
    if (device_id) {
      devices = await db.query('SELECT * FROM devices WHERE device_id = ?', [device_id]);
    } else if (mac) {
      devices = await db.query('SELECT * FROM devices WHERE mac_address = ?', [mac]);
    }

    if (devices.length === 0 && !device_id) {
      return res.status(404).json({ success: false, message: 'Device not found for provided MAC, please provide device_id' });
    }

    if (devices.length === 0 && device_id) {
      // Create new record linked to this user
      await db.query(`
        INSERT INTO devices (device_id, user_id, name, location, mac_address, mqtt_topic_cmd, mqtt_topic_resp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        device_id,
        req.user.id,
        name || `Device ${device_id}`,
        location || null,
        mac || null,
        `cmd/${device_id}`,
        `resp/${device_id}`
      ]);

      devices = await db.query('SELECT * FROM devices WHERE device_id = ?', [device_id]);
    } else if (devices.length > 0) {
      // Update ownership and optional fields if unowned or owned by same user
      const device = devices[0];
      if (device.user_id !== req.user.id) {
        // Allow relink only if not owned (or implement transfer policy as needed)
        // Here: if owned by someone else, forbid
        return res.status(403).json({ success: false, message: 'Device is owned by another user' });
      }

      const fields = [];
      const values = [];
      if (name) { fields.push('name = ?'); values.push(name); }
      if (location) { fields.push('location = ?'); values.push(location); }
      if (mac && !device.mac_address) { fields.push('mac_address = ?'); values.push(mac); }
      if (fields.length > 0) {
        values.push(device.id);
        await db.query(`UPDATE devices SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`, values);
      }
    }

    const deviceRecord = device_id
      ? (await db.query('SELECT * FROM devices WHERE device_id = ?', [device_id]))[0]
      : (await db.query('SELECT * FROM devices WHERE mac_address = ?', [mac]))[0];

    // Ensure backend subscribes to this device's resp topic
    await mqttService.subscribeToNewDevice(deviceRecord.device_id, `resp/${deviceRecord.device_id}`);

    return res.status(200).json({ success: true, message: 'Device linked successfully', data: { device: deviceRecord } });
  } catch (error) {
    console.error('Link device error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
