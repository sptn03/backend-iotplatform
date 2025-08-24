const mqtt = require('mqtt');
const os = require('os');
const db = require('../config/database');

class MQTTService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.subscriptions = new Map();
    this.messageHandlers = new Map();
  }

  async initialize() {
    try {
      const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://mqtt.nz03.com:1883';
      const baseClientId = process.env.MQTT_CLIENT_ID || `iot-platform-backend-${os.hostname()}`;
      const options = {
        clientId: `${baseClientId}-${process.pid}-${Math.random().toString(16).slice(2, 6)}`,
        clean: true,
        keepalive: parseInt(process.env.MQTT_KEEPALIVE || '30', 10),
        reconnectPeriod: parseInt(process.env.MQTT_RECONNECT_MS || '5000', 10),
        connectTimeout: parseInt(process.env.MQTT_CONNECT_TIMEOUT_MS || '15000', 10),
        protocolVersion: 4,
        resubscribe: true,
        username: process.env.MQTT_USERNAME || undefined,
        password: process.env.MQTT_PASSWORD || undefined,
        will: {
          topic: process.env.MQTT_WILL_TOPIC || 'backend/status',
          payload: JSON.stringify({ service: 'backend', status: 'offline', ts: Date.now() }),
          qos: 0,
          retain: false
        }
      };

      this.client = mqtt.connect(brokerUrl, options);

      this.client.on('connect', (connack) => {
        console.log('✅ MQTT client connected');
        this.isConnected = true;
        this.subscribeToDeviceTopics();
        this.subscribe('register', (topic, message) => this.handleRegistration(topic, message));
      });

      this.client.on('close', () => {
        console.log('🔌 MQTT connection closed');
        this.isConnected = false;
      });

      this.client.on('error', (error) => {
        console.error('❌ MQTT connection error:', error.message || error);
        this.isConnected = false;
      });

      this.client.on('offline', () => {
        console.log('⚠️ MQTT client offline');
        this.isConnected = false;
      });

      this.client.on('reconnect', () => {
        console.log('🔄 MQTT client reconnecting...');
      });

      this.client.on('end', () => {
        console.log('🛑 MQTT client ended');
      });

      this.client.on('message', (topic, message) => {
        this.handleMessage(topic, message);
      });

      return true;
    } catch (error) {
      console.error('❌ MQTT initialization failed:', error);
      throw error;
    }
  }

  async subscribeToDeviceTopics() {
    try {
      // Subscribe to all device response topics using wildcard
      this.subscribe('resp/+', (topic, message) => {
        // Extract deviceId from topic: resp/ESP32_XXX -> ESP32_XXX
        const deviceId = topic.split('/')[1];
        this.handleDeviceResponse(deviceId, topic, message);
      });

      // Subscribe to device sync topics
      this.subscribe('cmd/+', (topic, message) => {
        // Extract deviceId from topic: cmd/ESP32_XXX -> ESP32_XXX
        const deviceId = topic.split('/')[1];
        this.handleDeviceCommand(deviceId, topic, message);
      });

    } catch (error) {
      console.error('❌ Failed to subscribe to device topics:', error);
    }
  }

  subscribe(topic, handler) {
    if (!this.isConnected) {
      console.warn('⚠️ MQTT not connected, queuing subscription:', topic);
      return;
    }

    this.client.subscribe(topic, (err) => {
      if (err) {
        console.error(`❌ Failed to subscribe to ${topic}:`, err);
      } else {
        console.log(`✅ Subscribed to topic: ${topic}`);
        this.subscriptions.set(topic, true);
        if (handler) {
          this.messageHandlers.set(topic, handler);
        }
      }
    });
  }

  unsubscribe(topic) {
    if (!this.isConnected) {
      return;
    }

    this.client.unsubscribe(topic, (err) => {
      if (err) {
        console.error(`❌ Failed to unsubscribe from ${topic}:`, err);
      } else {
        console.log(`✅ Unsubscribed from topic: ${topic}`);
        this.subscriptions.delete(topic);
        this.messageHandlers.delete(topic);
      }
    });
  }

  publish(topic, message, options = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new Error('MQTT client not connected'));
        return;
      }

      const messageStr = typeof message === 'string' ? message : JSON.stringify(message);

      this.client.publish(topic, messageStr, options, (err) => {
        if (err) {
          console.error(`❌ Failed to publish to ${topic}:`, err);
          reject(err);
        } else {
          console.log(`✅ Published to topic: ${topic}`);
          resolve();
        }
      });
    });
  }

  async sendDeviceCommand(deviceId, command) {
    try {
      // Get device info
      const devices = await db.query('SELECT id, mqtt_topic_cmd FROM devices WHERE device_id = ?', [deviceId]);
      
      if (devices.length === 0) {
        throw new Error('Device not found');
      }

      const device = devices[0];
      
      if (!device.mqtt_topic_cmd) {
        throw new Error('Device command topic not configured');
      }

      // Save command to database
      const result = await db.query(
        'INSERT INTO device_commands (device_id, user_id, command, status) VALUES (?, ?, ?, ?)',
        [device.id, command.userId || null, JSON.stringify(command), 'pending']
      );

      const commandId = result.insertId;

      // Publish command to MQTT
      await this.publish(device.mqtt_topic_cmd, command);

      // Update command status
      await db.query(
        'UPDATE device_commands SET status = ?, sent_at = NOW() WHERE id = ?',
        ['sent', commandId]
      );

      return {
        commandId,
        topic: device.mqtt_topic_cmd,
        command
      };

    } catch (error) {
      console.error('❌ Failed to send device command:', error);
      throw error;
    }
  }

  handleMessage(topic, message) {
    try {
      const messageStr = message.toString();
      // Try exact topic handler first
      const exactHandler = this.messageHandlers.get(topic);
      if (exactHandler) {
        exactHandler(topic, messageStr);
        return;
      }

      // Try wildcard handlers (supports MQTT '+' and '#')
      for (const [pattern, handler] of this.messageHandlers.entries()) {
        if (this.matchesMqttTopic(pattern, topic)) {
          handler(topic, messageStr);
          return;
        }
      }

    } catch (error) {
      console.error('❌ Error handling MQTT message:', error);
    }
  }

  matchesMqttTopic(pattern, topic) {
    if (!pattern) return false;
    if (pattern === topic) return true;

    const patternLevels = pattern.split('/');
    const topicLevels = topic.split('/');

    for (let i = 0, j = 0; i < patternLevels.length; i++, j++) {
      const p = patternLevels[i];
      const t = topicLevels[j];

      if (p === '#') {
        return true; // matches remaining levels
      }

      if (t === undefined) {
        return false; // topic ended but pattern has more (and no '#')
      }

      if (p === '+') {
        continue; // matches exactly one level
      }

      if (p !== t) {
        return false;
      }
    }

    // Match only if both consumed (or pattern ended with '#')
    return topicLevels.length === patternLevels.length || patternLevels[patternLevels.length - 1] === '#';
  }

  // Command tracking for acknowledgments
  pendingCommands = new Map();
  commandCounter = 0;

  async sendCommand(boardId, commandType, commandData) {
    try {
      const commandId = `cmd_${++this.commandCounter}_${Date.now()}`;
      const topic = `cmd/${boardId}`;
      
      const message = {
        id: commandId,
        type: commandType,
        data: commandData,
        timestamp: new Date().toISOString()
      };
 
      // Build firmware payload for known command types (simple JSON commands expect 'action')
      let publishPayload = message; // default envelope
      let expectedAction = undefined;
      let expectedPin = undefined;
      if (commandType === 'add_device') {
        const devType = commandData?.data?.device_type;
        const pin = commandData?.data?.gpio_pin;
        const name = commandData?.data?.name;
        expectedPin = pin;
        if (devType === 'switch' || devType === 'dimmer') {
          expectedAction = 'gpio_config';
          publishPayload = {
            id: commandId,
            action: 'gpio_config',
            cmd: 'add',
            pin,
            type: devType === 'switch' ? 'output' : 'pwm',
            name
          };
        } else if (devType === 'sensor_dht22' || devType === 'sensor_ds18b20' || devType === 'sensor_analog') {
          expectedAction = 'sensor_config';
          publishPayload = {
            id: commandId,
            action: 'sensor_config',
            cmd: 'add',
            pin,
            type: devType === 'sensor_dht22' ? 'dht22' : (devType === 'sensor_ds18b20' ? 'ds18b20' : 'analog'),
            name
          };
        }
      } else if (commandType === 'gpio') {
        expectedAction = 'gpio';
        expectedPin = Number(commandData?.pin);
        publishPayload = {
          id: commandId,
          action: 'gpio',
          ...commandData
        };
      }
 
      // Store command for tracking
      this.pendingCommands.set(commandId, {
        boardId,
        commandType,
        status: 'pending',
        sentAt: new Date(),
        resolve: null,
        reject: null,
        expectedAction,
        expectedPin
      });
 
      // Record command in database only when the device already exists and it's not an add_device command
      const deviceIdForRow = commandData?.data?.device_id || null;
      if (deviceIdForRow && commandType !== 'add_device') {
        await db.query(`
          INSERT INTO device_commands (device_id, command_type, command_data, status, sent_at)
          VALUES (?, ?, ?, 'sent', CURRENT_TIMESTAMP)
        `, [deviceIdForRow, commandType, JSON.stringify(message)]);
      }
 
      // Publish command
      this.publish(topic, JSON.stringify(publishPayload), { qos: 2 }); // QoS 2 for important commands
       
      console.log(`📤 Sent command ${commandId} to board ${boardId}:`, commandType);
       
      return commandId;
    } catch (error) {
      console.error('❌ Failed to send command:', error);
      throw error;
    }
  }

  async waitForAck(commandId, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const command = this.pendingCommands.get(commandId);
      if (!command) {
        resolve(false);
        return;
      }

      // Set up promise resolvers
      command.resolve = resolve;
      command.reject = reject;

      // Set timeout
      setTimeout(() => {
        const cmd = this.pendingCommands.get(commandId);
        if (cmd && cmd.status === 'pending') {
          this.pendingCommands.delete(commandId);
          console.log(`⏰ Command ${commandId} timed out`);
          resolve(false);
        }
      }, timeoutMs);
    });
  }

  async handleDeviceResponse(deviceId, topic, message) {
    try {
      const payload = typeof message === 'string' ? message : message.toString();
      let data;
      
      try {
        data = JSON.parse(payload);
      } catch (e) {
        console.error('❌ Invalid JSON in device response:', payload);
        return;
      }

      // Handle command acknowledgments
      if (data.type === 'ack' && data.commandId) {
        const command = this.pendingCommands.get(data.commandId);
        if (command) {
          command.status = data.success ? 'acknowledged' : 'failed';
          command.acknowledgedAt = new Date();
          
          // Update database
          await db.query(`
            UPDATE device_commands 
            SET status = ?, acknowledged_at = CURRENT_TIMESTAMP, error_message = ?
            WHERE JSON_UNQUOTE(JSON_EXTRACT(command_data, '$.id')) = ?
          `, [command.status, data.error || null, data.commandId]);

          // Resolve promise
          if (command.resolve) {
            command.resolve(data.success);
          }
          
          this.pendingCommands.delete(data.commandId);
          console.log(`✅ Command ${data.commandId} acknowledged:`, data.success ? 'SUCCESS' : 'FAILED');
        }
        return;
      }

      // Handle firmware simple response style (status/action)
      if (data.status && data.action) {
        for (const [pendingId, pending] of this.pendingCommands.entries()) {
          if (pending.boardId === deviceId) {
            const actionMatches = !pending.expectedAction || pending.expectedAction === data.action;
            const pinMatches = !pending.expectedPin || (data.details && Number(data.details.pin) === Number(pending.expectedPin));
            if (actionMatches && pinMatches) {
              pending.status = data.status === 'success' ? 'acknowledged' : 'failed';
              pending.acknowledgedAt = new Date();
              if (pending.resolve) {
                pending.resolve(data.status === 'success');
              }
              this.pendingCommands.delete(pendingId);
              console.log(`✅ Command ${pendingId} resolved by firmware response (${data.action}):`, data.status);
              break;
            }
          }
        }
        // continue handling other types after
      }

      // Handle GPIO change events (map to device state updates)
      if (data.type === 'gpio_change' && data.details && typeof data.details.pin !== 'undefined') {
        const pin = Number(data.details.pin);
        const isOn = String(data.details.state).toUpperCase() === 'HIGH';
        const derivedDeviceId = `${deviceId}_GPIO${pin}`;

        // Update device state
        await this.updateDeviceState(derivedDeviceId, { state: isOn });

        // Store state change if device exists
        const existingDevices = await db.query('SELECT device_id FROM devices WHERE device_id = ? LIMIT 1', [derivedDeviceId]);
        if (existingDevices.length > 0) {
          await db.query(`
            INSERT INTO device_data (device_id, data_type, value, timestamp)
            VALUES (?, 'state', ?, CURRENT_TIMESTAMP)
          `, [derivedDeviceId, JSON.stringify({ pin, state: isOn, reason: data.details.reason || null })]);
        }

        // Broadcast via socket if available
        const socketService = require('./socketService');
        if (socketService) {
          socketService.broadcastDeviceUpdate(derivedDeviceId, { state: isOn });
        }
        return;
      }

      // Handle heartbeat/status updates
      if (data.type === 'heartbeat' || data.type === 'status') {
        await this.updateBoardStatus(deviceId, data);
        
        // Store heartbeat data only if a matching device exists to satisfy FK
        const existingDevices = await db.query(
          'SELECT device_id FROM devices WHERE device_id = ? LIMIT 1',
          [deviceId]
        );
        if (existingDevices.length > 0) {
          await db.query(`
            INSERT INTO device_data (device_id, data_type, value, timestamp)
            VALUES (?, 'heartbeat', ?, CURRENT_TIMESTAMP)
          `, [deviceId, JSON.stringify(data)]);
        }
        return;
      }

      // Handle sensor data
      if (data.type === 'sensor') {
        await db.query(`
          INSERT INTO device_data (device_id, data_type, value, timestamp)
          VALUES (?, 'sensor', ?, CURRENT_TIMESTAMP)
        `, [data.deviceId || deviceId, JSON.stringify(data.data)]);
        
        // Emit via Socket.IO if available
        if (this.socketService) {
          this.socketService.emitToDevice(data.deviceId || deviceId, 'sensor_data', data.data);
        }
        return;
      }

      // Handle device state changes
      if (data.type === 'state') {
        await this.updateDeviceState(data.deviceId || deviceId, data.state);
        
        // Store state change
        await db.query(`
          INSERT INTO device_data (device_id, data_type, value, timestamp)
          VALUES (?, 'state', ?, CURRENT_TIMESTAMP)
        `, [data.deviceId || deviceId, JSON.stringify(data.state)]);
        
        // Emit via Socket.IO if available
        if (this.socketService) {
          this.socketService.emitToDevice(data.deviceId || deviceId, 'state_change', data.state);
        }
        return;
      }

      // Handle device configuration sync
      if (data.type === 'device_sync') {
        await this.syncDeviceConfiguration(deviceId, data.devices);
        return;
      }

      // Handle errors
      if (data.type === 'error') {
        console.error(`❌ Device ${deviceId} reported error:`, data.error);
        
        await db.query(`
          INSERT INTO device_data (device_id, data_type, value, timestamp)
          VALUES (?, 'error', ?, CURRENT_TIMESTAMP)
        `, [deviceId, JSON.stringify(data)]);
        return;
      }

    } catch (error) {
      console.error('❌ Error handling device response:', error);
    }
  }

  async autoRegisterDevice(deviceId, data) {
    try {
      // Resolve user by shortId (preferred), else email, else numeric id
      let users = [];
      if (data.shortId) {
        users = await db.query('SELECT id FROM users WHERE short_id = ?', [data.shortId]);
      }
      if (users.length === 0 && data.userEmail) {
        users = await db.query('SELECT id FROM users WHERE email = ?', [data.userEmail]);
      }
      if (users.length === 0 && data.userId) {
        users = await db.query('SELECT id FROM users WHERE id = ?', [data.userId]);
      }

      if (users.length === 0) {
        console.log(`⚠️ User not found for board ${deviceId}, shortId: ${data.shortId}, email: ${data.userEmail}, userId: ${data.userId}`);
        return false;
      }

      const userId = users[0].id;
      const boardId = deviceId; // Align naming
      const mac = data.details?.mac || data.mac || null;
      const name = data.deviceName || `ESP32 ${boardId}`;
      const location = data.deviceLocation || '';
      const topicCmd = `cmd/${boardId}`;
      const topicResp = `resp/${boardId}`;

      // Check if board exists
      const [existingBoard] = await db.query('SELECT * FROM esp32_boards WHERE board_id = ?', [boardId]);

      if (!existingBoard) {
        // Create new board record
        await db.query(
          `INSERT INTO esp32_boards (board_id, mac_address, user_id, name, location, mqtt_topic_cmd, mqtt_topic_resp, is_online)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
          [boardId, mac, userId, name, location, topicCmd, topicResp]
        );
        console.log(`✅ Registered new board ${boardId} for user ${userId}${mac ? ` (MAC: ${mac})` : ''}`);
      } else {
        // Update ownership/topics/mac if needed
        const updatedUserId = existingBoard.user_id || userId;
        await db.query(
          `UPDATE esp32_boards 
           SET user_id = ?, 
               mac_address = COALESCE(?, mac_address),
               name = COALESCE(?, name),
               location = COALESCE(?, location),
               mqtt_topic_cmd = COALESCE(mqtt_topic_cmd, ?),
               mqtt_topic_resp = COALESCE(mqtt_topic_resp, ?),
               updated_at = CURRENT_TIMESTAMP
           WHERE board_id = ?`,
          [updatedUserId, mac, name, location, topicCmd, topicResp, boardId]
        );
        console.log(`✅ Updated board ${boardId} for user ${updatedUserId}${mac ? ` (MAC: ${mac})` : ''}`);
      }

      return true;
    } catch (error) {
      console.error('❌ Error auto-registering board:', error);
      return false;
    }
  }

  async handleHeartbeat(deviceId, data) {
    try {
      // Get device database ID
      const devices = await db.query('SELECT id FROM devices WHERE device_id = ?', [deviceId]);
      if (devices.length === 0) return;

      const deviceDbId = devices[0].id;

      // Extract IP, firmware version, MAC from data structure
      const ipAddress = data.details?.ip || data.ip || null;
      const firmwareVersion = data.details?.version || data.firmware_version || null;
      const mac = data.details?.mac || data.mac || null;

      // Update device status
      await db.query(
        'UPDATE devices SET is_online = true, last_seen = NOW(), ip_address = ?, firmware_version = ?, mac_address = COALESCE(?, mac_address) WHERE id = ?',
        [ipAddress, firmwareVersion, mac, deviceDbId]
      );

      console.log(`💓 Heartbeat from device ${deviceId}${mac ? ` (MAC: ${mac})` : ''}`);
    } catch (error) {
      console.error('❌ Error handling heartbeat:', error);
    }
  }

  async handleSensorData(deviceId, data) {
    try {
      // Get device database ID
      const devices = await db.query('SELECT id FROM devices WHERE device_id = ?', [deviceId]);
      if (devices.length === 0) return;

      const deviceDbId = devices[0].id;

      // Handle different sensor data formats
      let sensors = [];

      if (data.details && data.details.sensors && Array.isArray(data.details.sensors)) {
        // New format: data.details.sensors
        sensors = data.details.sensors;
      } else if (data.sensors && Array.isArray(data.sensors)) {
        // Old format: data.sensors
        sensors = data.sensors;
      }

      // Store sensor data
      for (const sensor of sensors) {
        await db.query(
          'INSERT INTO device_data (device_id, data_type, sensor_name, value, unit, raw_data) VALUES (?, ?, ?, ?, ?, ?)',
          [deviceDbId, 'sensor', sensor.name, sensor.value, sensor.unit || null, JSON.stringify(sensor)]
        );
      }

      console.log(`📊 Sensor data from device ${deviceId}:`, sensors.length, 'sensors');

      // Broadcast real-time data via socket if available
      const socketService = require('./socketService');
      if (socketService && sensors.length > 0) {
        socketService.broadcastSensorData(deviceId, sensors);
      }

    } catch (error) {
      console.error('❌ Error handling sensor data:', error);
    }
  }

  async handleCommandResponse(deviceId, data) {
    try {
      if (data.command_id) {
        // Update command status
        await db.query(
          'UPDATE device_commands SET status = ?, response = ?, acknowledged_at = NOW() WHERE id = ?',
          ['acknowledged', JSON.stringify(data), data.command_id]
        );
      }

      console.log(`✅ Command response from device ${deviceId}:`, data);
    } catch (error) {
      console.error('❌ Error handling command response:', error);
    }
  }

  async storeDeviceData(deviceId, dataType, data) {
    try {
      // Get device database ID
      const devices = await db.query('SELECT id FROM devices WHERE device_id = ?', [deviceId]);
      if (devices.length === 0) return;

      const deviceDbId = devices[0].id;

      // Store data
      await db.query(
        'INSERT INTO device_data (device_id, data_type, raw_data) VALUES (?, ?, ?)',
        [deviceDbId, dataType, JSON.stringify(data)]
      );

    } catch (error) {
      console.error('❌ Error storing device data:', error);
    }
  }

  async updateBoardStatus(boardId, data) {
    try {
      const version = (data.details && data.details.version) || data.version || data.firmware_version || null;
      const mac = (data.details && data.details.mac) || data.mac || null;
      const ip = (data.details && data.details.ip) || data.ip || null;
      const status = (data.status || '').toString().toLowerCase();
      const isOnline = status === 'offline' ? 0 : 1;

      await db.query(`
        UPDATE esp32_boards 
        SET is_online = ?, 
            last_seen = CURRENT_TIMESTAMP, 
            firmware_version = COALESCE(?, firmware_version),
            mac_address = COALESCE(?, mac_address)
        WHERE board_id = ?
      `, [isOnline, version, mac, boardId]);

      // Optionally update derived devices' online state in future
      
    } catch (error) {
      console.error('❌ Error updating board status:', error);
    }
  }

  async updateDeviceState(deviceId, state) {
    try {
      await db.query(`
        UPDATE devices 
        SET state = ?, updated_at = CURRENT_TIMESTAMP
        WHERE device_id = ?
      `, [JSON.stringify(state), deviceId]);
      
      console.log(`🔄 Device ${deviceId} state updated:`, state);
    } catch (error) {
      console.error('❌ Error updating device state:', error);
    }
  }

  async syncDeviceConfiguration(boardId, devicesList) {
    try {
      console.log(`🔄 Syncing device configuration for board ${boardId}:`, devicesList);
      
      // Get current devices from database
      const dbDevices = await db.query(`
        SELECT device_id, gpio_pin, device_type, name, config 
        FROM devices 
        WHERE board_id = ? AND is_enabled = 1
      `, [boardId]);

      // Update ESP32 with database configuration
      const syncCommand = {
        cmd: 'sync_devices',
        data: {
          devices: dbDevices.map(d => ({
            device_id: d.device_id,
            gpio_pin: d.gpio_pin,
            device_type: d.device_type,
            name: d.name,
            config: typeof d.config === 'string' ? JSON.parse(d.config) : d.config
          }))
        }
      };

      await this.sendCommand(boardId, 'sync_devices', syncCommand);
      
    } catch (error) {
      console.error('❌ Error syncing device configuration:', error);
    }
  }

  async handleRegistration(topic, message) {
    try {
      const payload = typeof message === 'string' ? message : message.toString();
      let data;
      try {
        data = JSON.parse(payload);
      } catch (e) {
        console.warn('⚠️ Invalid registration JSON:', payload);
        return;
      }

      const deviceId = data.deviceId;
      if (!deviceId || !data.shortId) {
        console.warn('⚠️ Registration missing deviceId or shortId');
        return;
      }

      // Link board to user via shortId and create topics if needed
      const ok = await this.autoRegisterDevice(deviceId, data);

      // Build ack based on result
      const ack = {
        action: 'registered',
        status: ok ? 'success' : 'failed',
        user_short_id: data.shortId,
        timestamp: new Date().toISOString(),
      };
      if (!ok) {
        ack.error = 'link_failed';
      }

      const replyTopic = data.replyTopic && typeof data.replyTopic === 'string' && data.replyTopic.length > 0
        ? data.replyTopic
        : `cmd/${deviceId}`;

      await this.publish(replyTopic, ack);

      console.log(`✅ Registration ack sent to ${replyTopic} (${ack.status})`);
    } catch (error) {
      console.error('❌ Error handling registration:', error);
    }
  }

  // ===== DEVICE SYNC HANDLERS =====

  async handleDeviceCommand(deviceId, topic, message) {
    try {
      const payload = typeof message === 'string' ? message : message.toString();
      let data;
      try {
        data = JSON.parse(payload);
      } catch (e) {
        console.warn('⚠️ Invalid device command JSON:', payload);
        return;
      }

      const action = data.action;
      console.log(`📥 Device command from ${deviceId}: ${action}`);

      switch (action) {
        case 'device_sync':
          await this.handleDeviceSync(deviceId, data);
          break;
        case 'device_request':
          await this.handleDeviceRequest(deviceId, data);
          break;
        default:
          console.log(`⚠️ Unknown device command action: ${action}`);
      }
    } catch (error) {
      console.error('❌ Error handling device command:', error);
    }
  }

  async handleDeviceSync(deviceId, data) {
    try {
      console.log(`📤 Device sync from ${deviceId}: ${data.devices?.length || 0} devices`);
      
      // Save devices to database
      if (data.devices && Array.isArray(data.devices)) {
        for (const device of data.devices) {
          await this.saveDeviceToDatabase(deviceId, device);
        }
      }

      // Send device list from database back to ESP32
      await this.sendDeviceListToESP32(deviceId);
      
    } catch (error) {
      console.error('❌ Error handling device sync:', error);
    }
  }

  async handleDeviceRequest(deviceId, data) {
    try {
      console.log(`📥 Device list request from ${deviceId}`);
      
      // Send device list from database to ESP32
      await this.sendDeviceListToESP32(deviceId);
      
    } catch (error) {
      console.error('❌ Error handling device request:', error);
    }
  }

  async saveDeviceToDatabase(boardId, device) {
    try {
      // Check if device exists
      const existing = await db.query(
        'SELECT id FROM devices WHERE board_id = ? AND device_id = ?',
        [boardId, device.device_id]
      );

      if (existing.length > 0) {
        // Update existing device
        await db.query(`
          UPDATE devices 
          SET name = ?, device_type = ?, gpio_pin = ?, config = ?, state = ?, updated_at = NOW()
          WHERE board_id = ? AND device_id = ?
        `, [
          device.name,
          device.device_type,
          device.gpio_pin,
          JSON.stringify(device.config || {}),
          JSON.stringify(device.state || {}),
          boardId,
          device.device_id
        ]);
        console.log(`✅ Device updated: ${device.device_id}`);
      } else {
        // Insert new device
        await db.query(`
          INSERT INTO devices (board_id, device_id, name, device_type, gpio_pin, config, state, is_enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `, [
          boardId,
          device.device_id,
          device.name,
          device.device_type,
          device.gpio_pin,
          JSON.stringify(device.config || {}),
          JSON.stringify(device.state || {}),
          device.is_enabled !== false ? 1 : 0
        ]);
        console.log(`✅ Device added: ${device.device_id}`);
      }
    } catch (error) {
      console.error('❌ Error saving device to database:', error);
    }
  }

  async sendDeviceListToESP32(deviceId) {
    try {
      // Get devices from database for this board
      const devices = await db.query(`
        SELECT device_id, name, device_type, gpio_pin, config, state, is_enabled
        FROM devices 
        WHERE board_id = ? AND is_enabled = 1
        ORDER BY created_at
      `, [deviceId]);

      // Format devices for ESP32
      const deviceList = devices.map(d => ({
        device_id: d.device_id,
        name: d.name,
        device_type: d.device_type,
        gpio_pin: d.gpio_pin,
        is_enabled: d.is_enabled === 1,
        config: typeof d.config === 'string' ? JSON.parse(d.config) : d.config,
        state: typeof d.state === 'string' ? JSON.parse(d.state) : d.state
      }));

      // Send device list response
      const response = {
        action: 'device_list_response',
        device_id: deviceId,
        timestamp: Date.now(),
        devices: deviceList
      };

      await this.publish(`cmd/${deviceId}`, response);
      console.log(`📤 Device list sent to ${deviceId}: ${deviceList.length} devices`);
      
    } catch (error) {
      console.error('❌ Error sending device list to ESP32:', error);
    }
  }

  disconnect() {
    if (this.client) {
      this.client.end();
      this.isConnected = false;
      console.log('✅ MQTT client disconnected');
    }
  }
}

// Create singleton instance
const mqttService = new MQTTService();

module.exports = mqttService;
