const express = require('express');
const { authMiddleware: auth } = require('../middleware/auth');
const DeviceController = require('../controllers/deviceController');

const router = express.Router();

// ===========================
// ESP32 BOARDS MANAGEMENT
// ===========================

/**
 * @swagger
 * /api/devices/boards:
 *   get:
 *     summary: Get all ESP32 boards for user
 *     tags: [ESP32 Boards]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of ESP32 boards
 */
router.get('/boards', auth, DeviceController.getBoards);

/**
 * @swagger
 * /api/devices/boards/{boardId}:
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
router.get('/boards/:boardId', auth, DeviceController.getBoardDetails);

/**
 * @swagger
 * /api/devices/boards/{boardId}:
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
router.put('/boards/:boardId', auth, DeviceController.updateBoard);

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
router.get('/', auth, DeviceController.listDevices);

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
router.post('/', auth, DeviceController.addDevice);

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
router.put('/:deviceId', auth, DeviceController.updateDevice);

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
router.delete('/:deviceId', auth, DeviceController.removeDevice);

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
router.post('/:deviceId/control', auth, DeviceController.controlDevice);

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
router.get('/:deviceId/data', auth, DeviceController.getDeviceData);

// Legacy route for device linking
router.post('/link', auth, (req, res) => {
  res.json({ success: true, message: 'Use ESP32 configuration portal to link device' });
});

module.exports = router;
