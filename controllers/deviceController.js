const DeviceModel = require('../models/deviceModel');
const mqttService = require('../services/mqttService');
const db = require('../config/database');

const DeviceController = {
  async getBoards(req, res) {
    try {
      const boards = await DeviceModel.getBoardsByUser(req.user.id);
      res.json({ success: true, data: boards });
    } catch (error) {
      console.error('Error fetching boards:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch boards' });
    }
  },

  async getBoardDetails(req, res) {
    try {
      const result = await DeviceModel.getBoardWithDevices(req.params.boardId, req.user.id);
      if (!result) return res.status(404).json({ success: false, message: 'Board not found' });
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error fetching board details:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch board details' });
    }
  },

  async updateBoard(req, res) {
    try {
      const { name, location } = req.body;
      const result = await DeviceModel.updateBoard(req.params.boardId, req.user.id, { name, location });
      if (result.notFound) return res.status(404).json({ success: false, message: 'Board not found' });
      if (result.offline) return res.status(400).json({ success: false, message: 'Board is offline. Cannot update.' });

      const updateCommand = { cmd: 'update_board', data: { name, location } };
      const commandId = await mqttService.sendCommand(req.params.boardId, 'config', updateCommand);
      const ackReceived = await mqttService.waitForAck(commandId, 10000);
      if (!ackReceived) {
        return res.status(408).json({ success: false, message: 'Board did not acknowledge update. Changes may not be applied.' });
      }

      res.json({ success: true, message: 'Board updated successfully' });
    } catch (error) {
      console.error('Error updating board:', error);
      res.status(500).json({ success: false, message: 'Failed to update board' });
    }
  },

  async listDevices(req, res) {
    try {
      const devices = await DeviceModel.getDevicesByUser(req.user.id);
      res.json({ success: true, data: devices });
    } catch (error) {
      console.error('Error fetching devices:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch devices' });
    }
  },

  async addDevice(req, res) {
    try {
      const { board_id, device_type, name, gpio_pin, config = {} } = req.body;
      if (!board_id || !device_type || !name || gpio_pin === undefined) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
      }

      const check = await DeviceModel.addDevice({ board_id, device_type, name, gpio_pin, config }, req.user.id);
      if (check.notFound) return res.status(404).json({ success: false, message: 'Board not found' });
      if (check.offline) return res.status(400).json({ success: false, message: 'Board is offline. Cannot add device.' });
      if (check.pinInUse) return res.status(409).json({ success: false, message: `GPIO pin ${gpio_pin} is already in use` });

      const device_id = check.device_id;
      const addDeviceCommand = {
        cmd: 'add_device',
        data: { device_id, device_type, name, gpio_pin, config }
      };
      const commandId = await mqttService.sendCommand(board_id, 'add_device', addDeviceCommand);
      const ackReceived = await mqttService.waitForAck(commandId, 15000);
      if (!ackReceived) {
        return res.status(408).json({ success: false, message: 'ESP32 did not acknowledge device addition. Device may not be added.' });
      }

      const initialState = await DeviceModel.persistAddedDevice({ device_id, board_id, device_type, name, gpio_pin, config });

      res.status(201).json({ success: true, message: 'Device added successfully', data: { device_id, device_type, name, gpio_pin, config, state: initialState } });
    } catch (error) {
      console.error('Error adding device:', error);
      res.status(500).json({ success: false, message: 'Failed to add device' });
    }
  },

  async updateDevice(req, res) {
    try {
      const { name, config } = req.body;
      const { deviceId } = req.params;

      const device = await DeviceModel.getDeviceWithBoard(deviceId, req.user.id);
      if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
      if (!device.is_online) return res.status(400).json({ success: false, message: 'Board is offline. Cannot update device.' });

      const updateCommand = { cmd: 'update_device', data: { device_id: deviceId, name, config } };
      const commandId = await mqttService.sendCommand(device.board_id, 'update_device', updateCommand);
      const ackReceived = await mqttService.waitForAck(commandId, 10000);
      if (!ackReceived) {
        return res.status(408).json({ success: false, message: 'ESP32 did not acknowledge update. Changes may not be applied.' });
      }

      await DeviceModel.updateDevice(deviceId, { name, config });
      res.json({ success: true, message: 'Device updated successfully' });
    } catch (error) {
      console.error('Error updating device:', error);
      res.status(500).json({ success: false, message: 'Failed to update device' });
    }
  },

  async removeDevice(req, res) {
    try {
      const { deviceId } = req.params;
      const result = await DeviceModel.deleteDevice(deviceId, req.user.id);
      if (result.notFound) return res.status(404).json({ success: false, message: 'Device not found' });
      if (result.offline) return res.status(400).json({ success: false, message: 'Board is offline. Cannot remove device.' });

      const removeCommand = { cmd: 'remove_device', data: { device_id: deviceId, gpio_pin: result.device.gpio_pin } };
      const commandId = await mqttService.sendCommand(result.device.board_id, 'remove_device', removeCommand);
      const ackReceived = await mqttService.waitForAck(commandId, 10000);
      if (!ackReceived) {
        return res.status(408).json({ success: false, message: 'ESP32 did not acknowledge removal. Device may still be active on board.' });
      }

      res.json({ success: true, message: 'Device removed successfully' });
    } catch (error) {
      console.error('Error removing device:', error);
      res.status(500).json({ success: false, message: 'Failed to remove device' });
    }
  },

  async controlDevice(req, res) {
    try {
      const { action, value, state } = req.body;
      const { deviceId } = req.params;
      const device = await DeviceModel.getDeviceWithBoard(deviceId, req.user.id);
      if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
      if (!device.is_online) return res.status(400).json({ success: false, message: 'Board is offline. Cannot control device.' });

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

      if (device.device_type === 'dimmer') {
        const pwmValue = Number(value);
        if (Number.isFinite(pwmValue)) {
          const commandId = await mqttService.sendCommand(device.board_id, 'pwm', { pin: device.gpio_pin, value: pwmValue });
          const ackReceived = await mqttService.waitForAck(commandId, 10000);
          if (!ackReceived) return res.status(408).json({ success: false, message: 'ESP32 did not acknowledge PWM command.' });
          return res.json({ success: true, message: 'PWM command sent successfully' });
        }
      }

      if (typeof desiredStateBool !== 'boolean') {
        return res.status(400).json({ success: false, message: 'Invalid control parameters. Provide state boolean or action turn_on/turn_off/toggle.' });
      }

      const fwState = desiredStateBool ? 'on' : 'off';
      const commandId = await mqttService.sendCommand(device.board_id, 'gpio', { pin: device.gpio_pin, state: fwState });
      const ackReceived = await mqttService.waitForAck(commandId, 10000);
      if (!ackReceived) return res.status(408).json({ success: false, message: 'ESP32 did not acknowledge control command.' });

      await db.query(
        `UPDATE devices SET state = JSON_SET(COALESCE(state, JSON_OBJECT()), '$.state', ?), updated_at = CURRENT_TIMESTAMP WHERE device_id = ?`,
        [desiredStateBool, deviceId]
      );

      res.json({ success: true, message: 'Control command sent successfully', state: desiredStateBool });
    } catch (error) {
      console.error('Error controlling device:', error);
      res.status(500).json({ success: false, message: 'Failed to control device' });
    }
  },

  async getDeviceData(req, res) {
    try {
      const { deviceId } = req.params;
      const limitRaw = parseInt(req.query.limit, 10);
      const safeLimit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 100;
      const dataType = req.query.data_type;

      const [device] = await db.query(`
        SELECT d.*, b.user_id
        FROM devices d
        JOIN esp32_boards b ON d.board_id = b.board_id
        WHERE d.device_id = ? AND b.user_id = ?
      `, [deviceId, req.user.id]);
      if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

      let query = `SELECT * FROM device_data WHERE device_id = ?`;
      const params = [deviceId];
      if (dataType) {
        query += ` AND data_type = ?`;
        params.push(dataType);
      }
      // Escape timestamp column and inline sanitized limit to avoid prepared LIMIT placeholder issue
      query += ` ORDER BY \`timestamp\` DESC LIMIT ${safeLimit}`;

      const data = await db.query(query, params);

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error fetching device data:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch device data' });
    }
  }
};

module.exports = DeviceController; 