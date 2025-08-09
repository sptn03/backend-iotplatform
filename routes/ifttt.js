const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const mqttService = require('../services/mqttService');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * /api/ifttt/status:
 *   get:
 *     summary: IFTTT service status endpoint
 *     tags: [IFTTT]
 *     responses:
 *       200:
 *         description: Service status
 */
router.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

/**
 * @swagger
 * /api/ifttt/test/setup:
 *   post:
 *     summary: IFTTT test setup endpoint
 *     tags: [IFTTT]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               samples:
 *                 type: object
 *     responses:
 *       200:
 *         description: Test setup successful
 */
router.post('/test/setup', (req, res) => {
  res.json({
    data: {
      samples: {
        triggers: {
          sensor_threshold_reached: {
            device_name: "Living Room Sensor",
            sensor_name: "temperature",
            threshold_value: "25.5",
            current_value: "26.2",
            unit: "°C"
          }
        },
        actions: {
          control_device: {
            device_name: "Living Room Light",
            action: "turn_on",
            pin: "2",
            value: "1"
          }
        }
      }
    }
  });
});

/**
 * @swagger
 * /api/ifttt/triggers/sensor_threshold_reached:
 *   post:
 *     summary: IFTTT trigger for sensor threshold reached
 *     tags: [IFTTT]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               trigger_fields:
 *                 type: object
 *                 properties:
 *                   device_name:
 *                     type: string
 *                   sensor_name:
 *                     type: string
 *                   threshold_value:
 *                     type: number
 *                   comparison:
 *                     type: string
 *                     enum: ['greater_than', 'less_than', 'equal_to']
 *               limit:
 *                 type: integer
 *                 default: 50
 *     responses:
 *       200:
 *         description: Trigger events
 */
router.post('/triggers/sensor_threshold_reached', authMiddleware, async (req, res) => {
  try {
    const { trigger_fields, limit = 50 } = req.body;
    const { device_name, sensor_name, threshold_value, comparison = 'greater_than' } = trigger_fields || {};

    if (!device_name || !sensor_name || threshold_value === undefined) {
      return res.status(400).json({
        errors: [
          {
            message: 'Missing required trigger fields: device_name, sensor_name, threshold_value'
          }
        ]
      });
    }

    // Get device by name
    const devices = await db.query(`
      SELECT id, device_id, name FROM devices 
      WHERE user_id = ? AND name = ?
    `, [req.user.id, device_name]);

    if (devices.length === 0) {
      return res.json({ data: [] });
    }

    const device = devices[0];

    // Build comparison condition
    let comparisonOp;
    switch (comparison) {
      case 'greater_than':
        comparisonOp = '>';
        break;
      case 'less_than':
        comparisonOp = '<';
        break;
      case 'equal_to':
        comparisonOp = '=';
        break;
      default:
        comparisonOp = '>';
    }

    // Get sensor data that meets threshold
    const sensorData = await db.query(`
      SELECT value, unit, timestamp
      FROM device_data
      WHERE device_id = ? AND sensor_name = ? AND value ${comparisonOp} ?
      ORDER BY timestamp DESC
      LIMIT ?
    `, [device.id, sensor_name, threshold_value, limit]);

    // Format for IFTTT
    const triggerEvents = sensorData.map(data => ({
      device_name: device_name,
      sensor_name: sensor_name,
      threshold_value: threshold_value.toString(),
      current_value: data.value.toString(),
      unit: data.unit || '',
      triggered_at: data.timestamp,
      meta: {
        id: `${device.device_id}_${sensor_name}_${data.timestamp}`,
        timestamp: Math.floor(new Date(data.timestamp).getTime() / 1000)
      }
    }));

    res.json({
      data: triggerEvents
    });

  } catch (error) {
    console.error('IFTTT sensor threshold trigger error:', error);
    res.status(500).json({
      errors: [
        {
          message: 'Internal server error'
        }
      ]
    });
  }
});

/**
 * @swagger
 * /api/ifttt/triggers/device_status_changed:
 *   post:
 *     summary: IFTTT trigger for device status changes
 *     tags: [IFTTT]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               trigger_fields:
 *                 type: object
 *                 properties:
 *                   device_name:
 *                     type: string
 *                   status:
 *                     type: string
 *                     enum: ['online', 'offline']
 *               limit:
 *                 type: integer
 *                 default: 50
 *     responses:
 *       200:
 *         description: Trigger events
 */
router.post('/triggers/device_status_changed', authMiddleware, async (req, res) => {
  try {
    const { trigger_fields, limit = 50 } = req.body;
    const { device_name, status } = trigger_fields || {};

    if (!device_name || !status) {
      return res.status(400).json({
        errors: [
          {
            message: 'Missing required trigger fields: device_name, status'
          }
        ]
      });
    }

    // Get device by name
    const devices = await db.query(`
      SELECT id, device_id, name, is_online, last_seen FROM devices 
      WHERE user_id = ? AND name = ?
    `, [req.user.id, device_name]);

    if (devices.length === 0) {
      return res.json({ data: [] });
    }

    const device = devices[0];
    const isOnline = status === 'online';

    // Check if device matches the desired status
    if (device.is_online === isOnline) {
      const triggerEvent = {
        device_name: device_name,
        status: status,
        changed_at: device.last_seen,
        meta: {
          id: `${device.device_id}_status_${status}_${device.last_seen}`,
          timestamp: Math.floor(new Date(device.last_seen).getTime() / 1000)
        }
      };

      res.json({
        data: [triggerEvent]
      });
    } else {
      res.json({ data: [] });
    }

  } catch (error) {
    console.error('IFTTT device status trigger error:', error);
    res.status(500).json({
      errors: [
        {
          message: 'Internal server error'
        }
      ]
    });
  }
});

/**
 * @swagger
 * /api/ifttt/actions/control_device:
 *   post:
 *     summary: IFTTT action to control device
 *     tags: [IFTTT]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               actionFields:
 *                 type: object
 *                 properties:
 *                   device_name:
 *                     type: string
 *                   action:
 *                     type: string
 *                     enum: ['turn_on', 'turn_off', 'set_value']
 *                   pin:
 *                     type: string
 *                   value:
 *                     type: string
 *     responses:
 *       200:
 *         description: Action executed successfully
 */
router.post('/actions/control_device', authMiddleware, async (req, res) => {
  try {
    const { actionFields } = req.body;
    const { device_name, action, pin, value } = actionFields || {};

    if (!device_name || !action) {
      return res.status(400).json({
        errors: [
          {
            message: 'Missing required action fields: device_name, action'
          }
        ]
      });
    }

    // Get device by name
    const devices = await db.query(`
      SELECT id, device_id, name FROM devices 
      WHERE user_id = ? AND name = ?
    `, [req.user.id, device_name]);

    if (devices.length === 0) {
      return res.status(400).json({
        errors: [
          {
            message: 'Device not found'
          }
        ]
      });
    }

    const device = devices[0];

    // Build MQTT command based on action
    let mqttCommand;
    switch (action) {
      case 'turn_on':
        mqttCommand = {
          action: 'gpio',
          pin: parseInt(pin) || 2,
          state: 'on',
          source: 'ifttt'
        };
        break;
      case 'turn_off':
        mqttCommand = {
          action: 'gpio',
          pin: parseInt(pin) || 2,
          state: 'off',
          source: 'ifttt'
        };
        break;
      case 'set_value':
        mqttCommand = {
          action: 'pwm',
          pin: parseInt(pin) || 2,
          value: parseInt(value) || 0,
          source: 'ifttt'
        };
        break;
      default:
        return res.status(400).json({
          errors: [
            {
              message: 'Invalid action type'
            }
          ]
        });
    }

    // Send command via MQTT
    await mqttService.sendDeviceCommand(device.device_id, {
      ...mqttCommand,
      userId: req.user.id,
      timestamp: new Date().toISOString()
    });

    res.json({
      data: [
        {
          id: `${device.device_id}_${action}_${Date.now()}`,
          url: `https://iotplatform.com/devices/${device.device_id}`
        }
      ]
    });

  } catch (error) {
    console.error('IFTTT control device action error:', error);
    res.status(500).json({
      errors: [
        {
          message: 'Failed to execute device control action'
        }
      ]
    });
  }
});

/**
 * @swagger
 * /api/ifttt/user/info:
 *   get:
 *     summary: Get IFTTT user info
 *     tags: [IFTTT]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User information
 */
router.get('/user/info', authMiddleware, async (req, res) => {
  try {
    // Get user's devices for IFTTT
    const devices = await db.query(`
      SELECT device_id, name, description, room
      FROM devices
      WHERE user_id = ?
      ORDER BY name
    `, [req.user.id]);

    res.json({
      data: {
        name: `${req.user.first_name} ${req.user.last_name}`,
        id: req.user.id.toString(),
        url: `https://iotplatform.com/users/${req.user.id}`,
        devices: devices.map(device => ({
          name: device.name,
          id: device.device_id,
          description: device.description || '',
          room: device.room || ''
        }))
      }
    });

  } catch (error) {
    console.error('IFTTT user info error:', error);
    res.status(500).json({
      errors: [
        {
          message: 'Internal server error'
        }
      ]
    });
  }
});

module.exports = router;
