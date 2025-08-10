const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authMiddleware: auth } = require('../middleware/auth');
const db = require('../config/database');
const mqttService = require('../services/mqttService');

// ===========================
// ESP32 BOARDS MANAGEMENT
// ===========================

/**
 * @swagger
 * /api/boards:
 *   get:
 *     summary: Get all ESP32 boards for user
 *     tags: [ESP32 Boards]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of ESP32 boards
 */
router.get('/boards', auth, async (req, res) => {
  try {
    const boards = await db.query(`
      SELECT b.*, 
             COUNT(d.id) as device_count,
             GROUP_CONCAT(d.device_type) as device_types
      FROM esp32_boards b
      LEFT JOIN devices d ON b.board_id = d.board_id AND d.is_enabled = 1
      WHERE b.user_id = ?
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `, [req.user.id]);

    res.json({ success: true, data: boards });
  } catch (error) {
    console.error('❌ Error fetching boards:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch boards' });
  }
});

/**
 * @swagger
 * /api/boards/{boardId}:
 *   get:
 *     summary: Get ESP32 board details with devices
 *     tags: [ESP32 Boards]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: boardId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Board details with devices
 */
router.get('/boards/:boardId', auth, async (req, res) => {
  try {
    const [board] = await db.query(`
      SELECT * FROM esp32_boards 
      WHERE board_id = ? AND user_id = ?
    `, [req.params.boardId, req.user.id]);

    if (!board) {
      return res.status(404).json({ success: false, message: 'Board not found' });
    }

    const devices = await db.query(`
      SELECT * FROM devices 
      WHERE board_id = ? 
      ORDER BY gpio_pin
    `, [req.params.boardId]);

    res.json({ success: true, data: { board, devices } });
  } catch (error) {
    console.error('❌ Error fetching board details:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch board details' });
  }
});

/**
 * @swagger
 * /api/boards/{boardId}:
 *   put:
 *     summary: Update ESP32 board
 *     tags: [ESP32 Boards]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: boardId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               location:
 *                 type: string
 *     responses:
 *       200:
 *         description: Board updated successfully
 */
router.put('/boards/:boardId', auth, async (req, res) => {
  try {
    const { name, location } = req.body;

    // Check if board exists and belongs to user
    const [board] = await db.query(`
      SELECT * FROM esp32_boards 
      WHERE board_id = ? AND user_id = ?
    `, [req.params.boardId, req.user.id]);

    if (!board) {
      return res.status(404).json({ success: false, message: 'Board not found' });
    }

    // Check if board is online
    if (!board.is_online) {
      return res.status(400).json({ success: false, message: 'Board is offline. Cannot update.' });
    }

    // Update board
    await db.query(`
      UPDATE esp32_boards 
      SET name = ?, location = ?, updated_at = CURRENT_TIMESTAMP
      WHERE board_id = ?
    `, [name, location, req.params.boardId]);

    // Send update command to ESP32
    const updateCommand = {
      cmd: 'update_board',
      data: { name, location }
    };

    const commandId = await mqttService.sendCommand(req.params.boardId, 'config', updateCommand);
    
    // Wait for acknowledgment
    const ackReceived = await mqttService.waitForAck(commandId, 10000); // 10 second timeout
    
    if (!ackReceived) {
      return res.status(408).json({ success: false, message: 'Board did not acknowledge update. Changes may not be applied.' });
    }

    res.json({ success: true, message: 'Board updated successfully' });
  } catch (error) {
    console.error('❌ Error updating board:', error);
    res.status(500).json({ success: false, message: 'Failed to update board' });
  }
});

// ===========================
// DEVICES MANAGEMENT
// ===========================

/**
 * @swagger
 * /api/devices:
 *   get:
 *     summary: Get all devices for user
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of devices
 */
router.get('/', auth, async (req, res) => {
  try {
    const devices = await db.query(`
      SELECT d.*, b.name as board_name, b.location as board_location, b.is_online as board_online
      FROM devices d
      JOIN esp32_boards b ON d.board_id = b.board_id
      WHERE b.user_id = ? AND d.is_enabled = 1
      ORDER BY b.name, d.gpio_pin
    `, [req.user.id]);

    res.json({ success: true, data: devices });
  } catch (error) {
    console.error('❌ Error fetching devices:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch devices' });
  }
});

/**
 * @swagger
 * /api/devices:
 *   post:
 *     summary: Add new device to ESP32 board
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
 *               - board_id
 *               - device_type
 *               - name
 *               - gpio_pin
 *             properties:
 *               board_id:
 *                 type: string
 *               device_type:
 *                 type: string
 *                 enum: [switch, dimmer, sensor_dht22, sensor_ds18b20, sensor_analog]
 *               name:
 *                 type: string
 *               gpio_pin:
 *                 type: integer
 *               config:
 *                 type: object
 *     responses:
 *       201:
 *         description: Device added successfully
 */
router.post('/', auth, async (req, res) => {
  try {
    const { board_id, device_type, name, gpio_pin, config = {} } = req.body;

    // Validate required fields
    if (!board_id || !device_type || !name || gpio_pin === undefined) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Check if board exists and belongs to user
    const [board] = await db.query(`
      SELECT * FROM esp32_boards 
      WHERE board_id = ? AND user_id = ?
    `, [board_id, req.user.id]);

    if (!board) {
      return res.status(404).json({ success: false, message: 'Board not found' });
    }

    // Check if board is online
    if (!board.is_online) {
      return res.status(400).json({ success: false, message: 'Board is offline. Cannot add device.' });
    }

    // Check if GPIO pin is already in use
    const [existingDevice] = await db.query(`
      SELECT * FROM devices 
      WHERE board_id = ? AND gpio_pin = ? AND is_enabled = 1
    `, [board_id, gpio_pin]);

    if (existingDevice) {
      return res.status(409).json({ success: false, message: `GPIO pin ${gpio_pin} is already in use` });
    }

    // Generate unique device ID
    const device_id = `${board_id}_GPIO${gpio_pin}`;

    // Send add device command to ESP32
    const addDeviceCommand = {
      cmd: 'add_device',
      data: {
      device_id,
        device_type,
      name,
        gpio_pin,
        config
      }
    };

    const commandId = await mqttService.sendCommand(board_id, 'add_device', addDeviceCommand);
    
    // Wait for acknowledgment from ESP32
    const ackReceived = await mqttService.waitForAck(commandId, 15000); // 15 second timeout
    
    if (!ackReceived) {
      return res.status(408).json({ success: false, message: 'ESP32 did not acknowledge device addition. Device may not be added.' });
    }

    // Add device to database only after ESP32 confirms
    const initialState = device_type === 'switch' ? { state: false } : {};
    
    await db.query(`
      INSERT INTO devices (device_id, board_id, device_type, name, gpio_pin, config, state, is_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `, [device_id, board_id, device_type, name, gpio_pin, JSON.stringify(config), JSON.stringify(initialState)]);

    res.status(201).json({
      success: true,
      message: 'Device added successfully',
      data: { device_id, device_type, name, gpio_pin, config, state: initialState }
    });

  } catch (error) {
    console.error('❌ Error adding device:', error);
    res.status(500).json({ success: false, message: 'Failed to add device' });
  }
});

/**
 * @swagger
 * /api/devices/{deviceId}:
 *   put:
 *     summary: Update device configuration
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               config:
 *                 type: object
 *     responses:
 *       200:
 *         description: Device updated successfully
 */
router.put('/:deviceId', auth, async (req, res) => {
  try {
    const { name, config } = req.body;
    const { deviceId } = req.params;

    // Check if device exists and user has access
    const [device] = await db.query(`
      SELECT d.*, b.user_id, b.is_online, b.board_id
      FROM devices d
      JOIN esp32_boards b ON d.board_id = b.board_id
      WHERE d.device_id = ? AND b.user_id = ?
    `, [deviceId, req.user.id]);

    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    // Check if board is online
    if (!device.is_online) {
      return res.status(400).json({ success: false, message: 'Board is offline. Cannot update device.' });
    }

    // Send update command to ESP32
    const updateCommand = {
      cmd: 'update_device',
      data: {
        device_id: deviceId,
        name,
        config
      }
    };

    const commandId = await mqttService.sendCommand(device.board_id, 'update_device', updateCommand);
    
    // Wait for acknowledgment
    const ackReceived = await mqttService.waitForAck(commandId, 10000);
    
    if (!ackReceived) {
      return res.status(408).json({ success: false, message: 'ESP32 did not acknowledge update. Changes may not be applied.' });
    }

    // Update device in database
    await db.query(`
      UPDATE devices 
      SET name = ?, config = ?, updated_at = CURRENT_TIMESTAMP
      WHERE device_id = ?
    `, [name, JSON.stringify(config), deviceId]);

    res.json({ success: true, message: 'Device updated successfully' });

  } catch (error) {
    console.error('❌ Error updating device:', error);
    res.status(500).json({ success: false, message: 'Failed to update device' });
  }
});

/**
 * @swagger
 * /api/devices/{deviceId}:
 *   delete:
 *     summary: Remove device from ESP32 board
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Device removed successfully
 */
router.delete('/:deviceId', auth, async (req, res) => {
  try {
    const { deviceId } = req.params;

    // Check if device exists and user has access
    const [device] = await db.query(`
      SELECT d.*, b.user_id, b.is_online, b.board_id
      FROM devices d
      JOIN esp32_boards b ON d.board_id = b.board_id
      WHERE d.device_id = ? AND b.user_id = ?
    `, [deviceId, req.user.id]);

    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    // Check if board is online
    if (!device.is_online) {
      return res.status(400).json({ success: false, message: 'Board is offline. Cannot remove device.' });
    }

    // Send remove command to ESP32
    const removeCommand = {
      cmd: 'remove_device',
      data: {
        device_id: deviceId,
        gpio_pin: device.gpio_pin
      }
    };

    const commandId = await mqttService.sendCommand(device.board_id, 'remove_device', removeCommand);
    
    // Wait for acknowledgment
    const ackReceived = await mqttService.waitForAck(commandId, 10000);
    
    if (!ackReceived) {
      return res.status(408).json({ success: false, message: 'ESP32 did not acknowledge removal. Device may still be active on board.' });
    }

    // Mark device as disabled in database (soft delete)
    await db.query(`
      UPDATE devices 
      SET is_enabled = 0, updated_at = CURRENT_TIMESTAMP
      WHERE device_id = ?
    `, [deviceId]);

    res.json({ success: true, message: 'Device removed successfully' });

  } catch (error) {
    console.error('❌ Error removing device:', error);
    res.status(500).json({ success: false, message: 'Failed to remove device' });
  }
});

/**
 * @swagger
 * /api/devices/{deviceId}/control:
 *   post:
 *     summary: Control device (turn on/off, set value, etc.)
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [turn_on, turn_off, toggle, set_value, set_brightness]
 *               value:
 *                 type: number
 *                 description: For dimmer or analog devices
 *     responses:
 *       200:
 *         description: Device controlled successfully
 */
router.post('/:deviceId/control', auth, async (req, res) => {
  try {
    const { action, value, state } = req.body;
    const { deviceId } = req.params;

    // Check if device exists and user has access
    const [device] = await db.query(`
      SELECT d.*, b.user_id, b.is_online, b.board_id
      FROM devices d
      JOIN esp32_boards b ON d.board_id = b.board_id
      WHERE d.device_id = ? AND b.user_id = ?
    `, [deviceId, req.user.id]);

    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    // Check if board is online
    if (!device.is_online) {
      return res.status(400).json({ success: false, message: 'Board is offline. Cannot control device.' });
    }

    // Determine desired state/value
    let desiredStateBool = undefined;
    if (typeof state === 'boolean') {
      desiredStateBool = state;
    } else if (typeof action === 'string') {
      const a = action.toLowerCase();
      if (a === 'turn_on' || a === 'on') desiredStateBool = true;
      else if (a === 'turn_off' || a === 'off') desiredStateBool = false;
      else if (a === 'toggle') {
        const current = device.state ? (typeof device.state === 'string' ? JSON.parse(device.state) : device.state) : { state: false };
        desiredStateBool = !Boolean(current.state);
      }
    }

    // Support PWM value for dimmer
    if (device.device_type === 'dimmer') {
      const pwmValue = Number(value);
      if (Number.isFinite(pwmValue)) {
        const commandId = await mqttService.sendCommand(device.board_id, 'pwm', { pin: device.gpio_pin, value: pwmValue });
        const ackReceived = await mqttService.waitForAck(commandId, 10000);
        if (!ackReceived) {
          return res.status(408).json({ success: false, message: 'ESP32 did not acknowledge PWM command.' });
        }
        return res.json({ success: true, message: 'PWM command sent successfully' });
      }
    }

    // Default: switch (on/off)
    if (typeof desiredStateBool !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Invalid control parameters. Provide state boolean or action turn_on/turn_off/toggle.' });
    }

    const fwState = desiredStateBool ? 'on' : 'off';
    const commandId = await mqttService.sendCommand(device.board_id, 'gpio', { pin: device.gpio_pin, state: fwState });

    // Wait for acknowledgment
    const ackReceived = await mqttService.waitForAck(commandId, 10000);
    if (!ackReceived) {
      return res.status(408).json({ success: false, message: 'ESP32 did not acknowledge control command.' });
    }

    // Optimistic update (actual state will also be updated on gpio_change)
    await db.query(`
      UPDATE devices SET state = JSON_SET(COALESCE(state, JSON_OBJECT()), '$.state', ?), updated_at = CURRENT_TIMESTAMP
      WHERE device_id = ?
    `, [desiredStateBool, deviceId]);

    res.json({ success: true, message: 'Control command sent successfully', state: desiredStateBool });

  } catch (error) {
    console.error('❌ Error controlling device:', error);
    res.status(500).json({ success: false, message: 'Failed to control device' });
  }
});

/**
 * @swagger
 * /api/devices/{deviceId}/data:
 *   get:
 *     summary: Get device data history
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *       - in: query
 *         name: data_type
 *         schema:
 *           type: string
 *           enum: [state, sensor, heartbeat, error]
 *     responses:
 *       200:
 *         description: Device data history
 */
router.get('/:deviceId/data', auth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const dataType = req.query.data_type;

    // Check if device exists and user has access
    const [device] = await db.query(`
      SELECT d.*, b.user_id
      FROM devices d
      JOIN esp32_boards b ON d.board_id = b.board_id
      WHERE d.device_id = ? AND b.user_id = ?
    `, [deviceId, req.user.id]);

    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    // Build query
    let query = `
      SELECT * FROM device_data 
      WHERE device_id = ?
    `;
    const params = [deviceId];

    if (dataType) {
      query += ` AND data_type = ?`;
      params.push(dataType);
    }

    query += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    const data = await db.query(query, params);

    res.json({ success: true, data });

  } catch (error) {
    console.error('❌ Error fetching device data:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch device data' });
  }
});

// Legacy route for device linking (still needed for ESP32 registration)
router.post('/link', auth, async (req, res) => {
  try {
    const { shortId, deviceName, deviceLocation } = req.body;

    if (!shortId) {
      return res.status(400).json({ success: false, message: 'Short ID is required' });
    }

    // This will be handled by MQTT registration flow
    res.json({ success: true, message: 'Use ESP32 configuration portal to link device' });

  } catch (error) {
    console.error('❌ Error in device linking:', error);
    res.status(500).json({ success: false, message: 'Failed to link device' });
  }
});

module.exports = router;
