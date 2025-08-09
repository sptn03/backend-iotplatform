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
      const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
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
        if (connack) console.log('🔎 ConnAck:', connack);
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
      // Subscribe to all device response topics
      const devices = await db.query('SELECT device_id, mqtt_topic_resp FROM devices WHERE mqtt_topic_resp IS NOT NULL');
      
      for (const device of devices) {
        if (device.mqtt_topic_resp) {
          this.subscribe(device.mqtt_topic_resp, (topic, message) => {
            this.handleDeviceResponse(device.device_id, topic, message);
          });
        }
      }

      console.log(`✅ Subscribed to ${devices.length} device response topics`);
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
      console.log(`📨 MQTT message received on ${topic}:`, messageStr);

      // Check for specific topic handlers
      const handler = this.messageHandlers.get(topic);
      if (handler) {
        handler(topic, messageStr);
      }

    } catch (error) {
      console.error('❌ Error handling MQTT message:', error);
    }
  }

  async handleDeviceResponse(deviceId, topic, message) {
    try {
      const messageStr = message.toString();
      let data;

      try {
        data = JSON.parse(messageStr);
      } catch (parseError) {
        console.warn('⚠️ Non-JSON message received:', messageStr);
        data = { raw_message: messageStr };
      }

      // Auto-register device if it has user ID but not in database
      if (data.userId && data.userEmail) {
        await this.autoRegisterDevice(deviceId, data);
      }

      // Update device last seen
      await db.query(
        'UPDATE devices SET last_seen = NOW(), is_online = true WHERE device_id = ?',
        [deviceId]
      );

      // Handle different types of responses
      if (data.type === 'heartbeat' || data.action === 'ping') {
        await this.handleHeartbeat(deviceId, data);
      } else if (data.type === 'sensor_data') {
        await this.handleSensorData(deviceId, data);
      } else if (data.type === 'command_response') {
        await this.handleCommandResponse(deviceId, data);
      } else {
        // Store as general device data
        await this.storeDeviceData(deviceId, 'general', data);
      }

    } catch (error) {
      console.error('❌ Error handling device response:', error);
    }
  }

  async autoRegisterDevice(deviceId, data) {
    try {
      // Check if device already exists
      const existingDevices = await db.query('SELECT id FROM devices WHERE device_id = ?', [deviceId]);
      if (existingDevices.length > 0) {
        return; // Device already registered
      }

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
        console.log(`⚠️ User not found for device ${deviceId}, shortId: ${data.shortId}, email: ${data.userEmail}, userId: ${data.userId}`);
        return;
      }

      const userId = users[0].id;
      const deviceName = data.deviceName || `Device ${deviceId}`;
      const deviceLocation = data.deviceLocation || '';
      const mac = data.details?.mac || data.mac || null;

      // Auto-register device with topics
      await db.query(`
        INSERT INTO devices (device_id, user_id, name, description, location, mac_address, mqtt_topic_cmd, mqtt_topic_resp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        deviceId,
        userId,
        deviceName,
        `Auto-registered device from MQTT`,
        deviceLocation,
        mac,
        `cmd/${deviceId}`,
        `resp/${deviceId}`
      ]);

      console.log(`✅ Auto-registered device ${deviceId} for user ${userId} ${mac ? `(MAC: ${mac})` : ''}`);

      // Subscribe to this new device
      await this.subscribeToNewDevice(deviceId, `resp/${deviceId}`);

    } catch (error) {
      console.error('❌ Error auto-registering device:', error);
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

  async subscribeToNewDevice(deviceId, responseTopic) {
    this.subscribe(responseTopic, (topic, message) => {
      this.handleDeviceResponse(deviceId, topic, message);
    });
  }

  async unsubscribeFromDevice(responseTopic) {
    this.unsubscribe(responseTopic);
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

      // Link device to user via shortId and create topics if needed
      await this.autoRegisterDevice(deviceId, data);

      // Ensure we subscribe to its response topic
      await this.subscribeToNewDevice(deviceId, `resp/${deviceId}`);

      // Acknowledge to device so it can exit AP mode
      const ack = {
        action: 'registered',
        status: 'success',
        user_short_id: data.shortId,
        timestamp: new Date().toISOString()
      };
      await this.publish(`cmd/${deviceId}`, ack);

      console.log(`✅ Registration ack sent to cmd/${deviceId}`);
    } catch (error) {
      console.error('❌ Error handling registration:', error);
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
