const db = require('../config/database');
const mqttService = require('./mqttService');

class GoogleHomeService {
  constructor() {
    this.deviceTypes = {
      'light': 'action.devices.types.LIGHT',
      'switch': 'action.devices.types.SWITCH',
      'outlet': 'action.devices.types.OUTLET',
      'fan': 'action.devices.types.FAN',
      'thermostat': 'action.devices.types.THERMOSTAT',
      'sensor': 'action.devices.types.SENSOR'
    };

    this.deviceTraits = {
      'light': ['action.devices.traits.OnOff', 'action.devices.traits.Brightness'],
      'switch': ['action.devices.traits.OnOff'],
      'outlet': ['action.devices.traits.OnOff'],
      'fan': ['action.devices.traits.OnOff', 'action.devices.traits.FanSpeed'],
      'thermostat': ['action.devices.traits.TemperatureSetting'],
      'sensor': ['action.devices.traits.SensorState']
    };
  }

  async handleSync(userId) {
    try {
      console.log(`🔄 Google Home SYNC request for user ${userId}`);

      // Get user's devices
      const devices = await db.query(`
        SELECT device_id, name, description, room, device_type, config, is_online
        FROM devices
        WHERE user_id = ?
        ORDER BY name
      `, [userId]);

      const googleDevices = devices.map(device => {
        const deviceConfig = device.config ? JSON.parse(device.config) : {};
        const deviceType = deviceConfig.google_type || 'switch';
        
        return {
          id: device.device_id,
          type: this.deviceTypes[deviceType] || this.deviceTypes.switch,
          traits: this.deviceTraits[deviceType] || this.deviceTraits.switch,
          name: {
            defaultNames: [device.name],
            name: device.name,
            nicknames: [device.name, device.device_id]
          },
          deviceInfo: {
            manufacturer: 'IoT Platform',
            model: device.device_type || 'ESP32',
            hwVersion: '1.0',
            swVersion: '2.0.0'
          },
          roomHint: device.room || 'Unknown',
          willReportState: true,
          attributes: this.getDeviceAttributes(deviceType, deviceConfig),
          customData: {
            deviceId: device.device_id,
            userId: userId
          }
        };
      });

      console.log(`✅ SYNC response: ${googleDevices.length} devices`);

      return {
        agentUserId: userId.toString(),
        devices: googleDevices
      };

    } catch (error) {
      console.error('❌ Google Home SYNC error:', error);
      throw error;
    }
  }

  async handleQuery(devices) {
    try {
      console.log(`🔍 Google Home QUERY request for ${devices.length} devices`);

      const deviceStates = {};

      for (const device of devices) {
        try {
          // Get device from database
          const deviceData = await db.query(`
            SELECT id, device_id, is_online, last_seen, config
            FROM devices
            WHERE device_id = ?
          `, [device.id]);

          if (deviceData.length === 0) {
            deviceStates[device.id] = {
              online: false,
              status: 'ERROR',
              errorCode: 'deviceNotFound'
            };
            continue;
          }

          const dbDevice = deviceData[0];
          const deviceConfig = dbDevice.config ? JSON.parse(dbDevice.config) : {};

          // Get latest sensor data for state
          const sensorData = await db.query(`
            SELECT sensor_name, value, timestamp
            FROM device_data
            WHERE device_id = ? AND data_type = 'sensor'
            ORDER BY timestamp DESC
            LIMIT 10
          `, [dbDevice.id]);

          // Build device state
          const state = {
            online: dbDevice.is_online,
            status: 'SUCCESS'
          };

          // Add trait-specific states
          const deviceType = deviceConfig.google_type || 'switch';
          this.addTraitStates(state, deviceType, sensorData, deviceConfig);

          deviceStates[device.id] = state;

        } catch (error) {
          console.error(`❌ Error querying device ${device.id}:`, error);
          deviceStates[device.id] = {
            online: false,
            status: 'ERROR',
            errorCode: 'hardError'
          };
        }
      }

      console.log(`✅ QUERY response for ${Object.keys(deviceStates).length} devices`);
      return { devices: deviceStates };

    } catch (error) {
      console.error('❌ Google Home QUERY error:', error);
      throw error;
    }
  }

  async handleExecute(commands) {
    try {
      console.log(`⚡ Google Home EXECUTE request: ${commands.length} commands`);

      const commandResults = [];

      for (const command of commands) {
        for (const device of command.devices) {
          for (const execution of command.execution) {
            try {
              const result = await this.executeDeviceCommand(device.id, execution);
              commandResults.push(result);
            } catch (error) {
              console.error(`❌ Error executing command for device ${device.id}:`, error);
              commandResults.push({
                ids: [device.id],
                status: 'ERROR',
                errorCode: 'hardError'
              });
            }
          }
        }
      }

      console.log(`✅ EXECUTE response: ${commandResults.length} results`);
      return { commands: commandResults };

    } catch (error) {
      console.error('❌ Google Home EXECUTE error:', error);
      throw error;
    }
  }

  async executeDeviceCommand(deviceId, execution) {
    try {
      // Get device from database
      const devices = await db.query(`
        SELECT id, device_id, user_id, config
        FROM devices
        WHERE device_id = ?
      `, [deviceId]);

      if (devices.length === 0) {
        return {
          ids: [deviceId],
          status: 'ERROR',
          errorCode: 'deviceNotFound'
        };
      }

      const device = devices[0];
      const deviceConfig = device.config ? JSON.parse(device.config) : {};

      // Convert Google command to MQTT command
      const mqttCommand = this.convertGoogleCommandToMQTT(execution, deviceConfig);

      if (!mqttCommand) {
        return {
          ids: [deviceId],
          status: 'ERROR',
          errorCode: 'functionNotSupported'
        };
      }

      // Add metadata
      mqttCommand.source = 'google_home';
      mqttCommand.userId = device.user_id;
      mqttCommand.timestamp = new Date().toISOString();

      // Send command via MQTT
      await mqttService.sendDeviceCommand(deviceId, mqttCommand);

      // Build response state
      const responseState = this.buildResponseState(execution);

      return {
        ids: [deviceId],
        status: 'SUCCESS',
        states: responseState
      };

    } catch (error) {
      console.error(`❌ Error executing device command:`, error);
      return {
        ids: [deviceId],
        status: 'ERROR',
        errorCode: 'hardError'
      };
    }
  }

  getDeviceAttributes(deviceType, config) {
    const attributes = {};

    switch (deviceType) {
      case 'light':
        if (config.supports_brightness) {
          attributes.colorModel = 'rgb';
        }
        break;
      case 'fan':
        attributes.availableFanSpeeds = {
          speeds: [
            { speed_name: 'low', speed_values: [{ speed_synonym: ['low', 'slow'], lang: 'en' }] },
            { speed_name: 'medium', speed_values: [{ speed_synonym: ['medium', 'mid'], lang: 'en' }] },
            { speed_name: 'high', speed_values: [{ speed_synonym: ['high', 'fast'], lang: 'en' }] }
          ],
          ordered: true
        };
        break;
      case 'thermostat':
        attributes.availableThermostatModes = ['off', 'heat', 'cool', 'auto'];
        attributes.thermostatTemperatureUnit = 'C';
        break;
    }

    return attributes;
  }

  addTraitStates(state, deviceType, sensorData, config) {
    // Add OnOff trait state
    if (this.deviceTraits[deviceType]?.includes('action.devices.traits.OnOff')) {
      state.on = state.online; // Default to online status
    }

    // Add device-specific states based on sensor data
    const sensorMap = {};
    sensorData.forEach(sensor => {
      sensorMap[sensor.sensor_name] = sensor.value;
    });

    switch (deviceType) {
      case 'light':
        if (config.supports_brightness && sensorMap.brightness !== undefined) {
          state.brightness = Math.round(sensorMap.brightness);
        }
        break;
      case 'fan':
        if (sensorMap.fan_speed !== undefined) {
          state.currentFanSpeedSetting = this.mapFanSpeed(sensorMap.fan_speed);
        }
        break;
      case 'thermostat':
        if (sensorMap.temperature !== undefined) {
          state.thermostatTemperatureAmbient = parseFloat(sensorMap.temperature);
        }
        if (sensorMap.target_temperature !== undefined) {
          state.thermostatTemperatureSetpoint = parseFloat(sensorMap.target_temperature);
        }
        state.thermostatMode = sensorMap.thermostat_mode || 'auto';
        break;
      case 'sensor':
        if (sensorMap.temperature !== undefined) {
          state.currentSensorStateData = [{
            name: 'AmbientTemperature',
            currentSensorState: 'temperature',
            rawValue: parseFloat(sensorMap.temperature)
          }];
        }
        break;
    }
  }

  convertGoogleCommandToMQTT(execution, config) {
    const { command, params } = execution;

    switch (command) {
      case 'action.devices.commands.OnOff':
        return {
          action: 'gpio',
          pin: config.control_pin || 2,
          state: params.on ? 'on' : 'off'
        };

      case 'action.devices.commands.BrightnessAbsolute':
        return {
          action: 'pwm',
          pin: config.control_pin || 2,
          value: Math.round((params.brightness / 100) * 255)
        };

      case 'action.devices.commands.SetFanSpeed':
        const speedMap = { low: 85, medium: 170, high: 255 };
        return {
          action: 'pwm',
          pin: config.control_pin || 2,
          value: speedMap[params.fanSpeed] || 255
        };

      case 'action.devices.commands.ThermostatTemperatureSetpoint':
        return {
          action: 'thermostat',
          target_temperature: params.thermostatTemperatureSetpoint
        };

      default:
        console.warn(`❌ Unsupported Google command: ${command}`);
        return null;
    }
  }

  buildResponseState(execution) {
    const { command, params } = execution;
    const state = {};

    switch (command) {
      case 'action.devices.commands.OnOff':
        state.on = params.on;
        break;
      case 'action.devices.commands.BrightnessAbsolute':
        state.brightness = params.brightness;
        break;
      case 'action.devices.commands.SetFanSpeed':
        state.currentFanSpeedSetting = params.fanSpeed;
        break;
      case 'action.devices.commands.ThermostatTemperatureSetpoint':
        state.thermostatTemperatureSetpoint = params.thermostatTemperatureSetpoint;
        break;
    }

    return state;
  }

  mapFanSpeed(value) {
    if (value <= 85) return 'low';
    if (value <= 170) return 'medium';
    return 'high';
  }
}

// Create singleton instance
const googleHomeService = new GoogleHomeService();

module.exports = googleHomeService;
