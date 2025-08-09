const db = require('../config/database');
const mqttService = require('./mqttService');
const axios = require('axios');

class SmartThingsService {
  constructor() {
    this.apiBaseUrl = 'https://api.smartthings.com/v1';
    this.deviceTypes = {
      'light': 'Light',
      'switch': 'Switch',
      'outlet': 'Outlet',
      'fan': 'Fan',
      'thermostat': 'Thermostat',
      'sensor': 'TemperatureMeasurement'
    };

    this.capabilities = {
      'light': ['switch', 'switchLevel', 'colorControl'],
      'switch': ['switch'],
      'outlet': ['switch'],
      'fan': ['switch', 'fanSpeed'],
      'thermostat': ['thermostatMode', 'thermostatSetpoint', 'temperatureMeasurement'],
      'sensor': ['temperatureMeasurement', 'relativeHumidityMeasurement']
    };
  }

  async handleWebhook(req) {
    try {
      const { lifecycle, executionId, locale, version } = req.body;

      console.log(`📱 SmartThings webhook: ${lifecycle}`);

      let response;

      switch (lifecycle) {
        case 'PING':
          response = await this.handlePing(req.body);
          break;
        case 'CONFIGURATION':
          response = await this.handleConfiguration(req.body);
          break;
        case 'INSTALL':
          response = await this.handleInstall(req.body);
          break;
        case 'UPDATE':
          response = await this.handleUpdate(req.body);
          break;
        case 'UNINSTALL':
          response = await this.handleUninstall(req.body);
          break;
        case 'COMMAND':
          response = await this.handleCommand(req.body);
          break;
        case 'EVENT':
          response = await this.handleEvent(req.body);
          break;
        default:
          throw new Error(`Unsupported lifecycle: ${lifecycle}`);
      }

      return response;

    } catch (error) {
      console.error('❌ SmartThings webhook error:', error);
      throw error;
    }
  }

  async handlePing(body) {
    return {
      pingData: {
        challenge: body.pingData.challenge
      }
    };
  }

  async handleConfiguration(body) {
    const { configurationData } = body;
    const { phase } = configurationData;

    switch (phase) {
      case 'INITIALIZE':
        return {
          configurationData: {
            initialize: {
              name: 'IoT Platform',
              description: 'Connect your ESP32 IoT devices to SmartThings',
              id: 'iot-platform-app',
              permissions: ['r:devices:*', 'x:devices:*'],
              firstPageId: '1'
            }
          }
        };

      case 'PAGE':
        return {
          configurationData: {
            page: {
              pageId: '1',
              name: 'Connect IoT Platform',
              nextPageId: null,
              previousPageId: null,
              complete: true,
              sections: [
                {
                  name: 'Authentication',
                  settings: [
                    {
                      id: 'accessToken',
                      name: 'Access Token',
                      description: 'Enter your IoT Platform access token',
                      type: 'TEXT',
                      required: true
                    }
                  ]
                }
              ]
            }
          }
        };

      default:
        throw new Error(`Unsupported configuration phase: ${phase}`);
    }
  }

  async handleInstall(body) {
    try {
      const { installData } = body;
      const { authToken, refreshToken, installedApp } = installData;

      // Store installation data
      await db.query(`
        INSERT INTO smart_home_integrations 
        (user_id, platform, platform_user_id, access_token, refresh_token, is_active, settings)
        VALUES (?, 'smartthings', ?, ?, ?, true, ?)
      `, [
        1, // You'll need to determine user ID from auth token
        installedApp.installedAppId,
        authToken,
        refreshToken,
        JSON.stringify(installedApp)
      ]);

      console.log(`✅ SmartThings app installed: ${installedApp.installedAppId}`);

      return {
        installData: {}
      };

    } catch (error) {
      console.error('❌ SmartThings install error:', error);
      throw error;
    }
  }

  async handleUpdate(body) {
    try {
      const { updateData } = body;
      const { authToken, refreshToken, installedApp } = updateData;

      // Update installation data
      await db.query(`
        UPDATE smart_home_integrations 
        SET access_token = ?, refresh_token = ?, settings = ?, updated_at = NOW()
        WHERE platform = 'smartthings' AND platform_user_id = ?
      `, [
        authToken,
        refreshToken,
        JSON.stringify(installedApp),
        installedApp.installedAppId
      ]);

      console.log(`✅ SmartThings app updated: ${installedApp.installedAppId}`);

      return {
        updateData: {}
      };

    } catch (error) {
      console.error('❌ SmartThings update error:', error);
      throw error;
    }
  }

  async handleUninstall(body) {
    try {
      const { uninstallData } = body;
      const { installedApp } = uninstallData;

      // Deactivate integration
      await db.query(`
        UPDATE smart_home_integrations 
        SET is_active = false, updated_at = NOW()
        WHERE platform = 'smartthings' AND platform_user_id = ?
      `, [installedApp.installedAppId]);

      console.log(`✅ SmartThings app uninstalled: ${installedApp.installedAppId}`);

      return {
        uninstallData: {}
      };

    } catch (error) {
      console.error('❌ SmartThings uninstall error:', error);
      throw error;
    }
  }

  async handleCommand(body) {
    try {
      const { commandData } = body;
      const { installedApp, commands } = commandData;

      const results = [];

      for (const command of commands) {
        const { deviceId, capability, command: cmd, arguments: args } = command;

        try {
          // Find device in our database
          const devices = await db.query(`
            SELECT id, device_id, user_id, config
            FROM devices
            WHERE device_id = ?
          `, [deviceId]);

          if (devices.length === 0) {
            results.push({
              deviceId,
              status: 'FAILURE',
              errorMessage: 'Device not found'
            });
            continue;
          }

          const device = devices[0];
          const deviceConfig = device.config ? JSON.parse(device.config) : {};

          // Convert SmartThings command to MQTT command
          const mqttCommand = this.convertSmartThingsCommandToMQTT(capability, cmd, args, deviceConfig);

          if (!mqttCommand) {
            results.push({
              deviceId,
              status: 'FAILURE',
              errorMessage: 'Unsupported command'
            });
            continue;
          }

          // Add metadata
          mqttCommand.source = 'smartthings';
          mqttCommand.userId = device.user_id;
          mqttCommand.timestamp = new Date().toISOString();

          // Send command via MQTT
          await mqttService.sendDeviceCommand(device.device_id, mqttCommand);

          results.push({
            deviceId,
            status: 'SUCCESS'
          });

        } catch (error) {
          console.error(`❌ Error executing command for device ${deviceId}:`, error);
          results.push({
            deviceId,
            status: 'FAILURE',
            errorMessage: error.message
          });
        }
      }

      return {
        commandData: {
          deviceCommandResults: results
        }
      };

    } catch (error) {
      console.error('❌ SmartThings command error:', error);
      throw error;
    }
  }

  async handleEvent(body) {
    try {
      const { eventData } = body;
      const { installedApp, events } = eventData;

      console.log(`📡 SmartThings events received: ${events.length} events`);

      // Process events (device state changes, etc.)
      for (const event of events) {
        console.log(`Event: ${event.eventType} for ${event.deviceId}`);
      }

      return {
        eventData: {}
      };

    } catch (error) {
      console.error('❌ SmartThings event error:', error);
      throw error;
    }
  }

  convertSmartThingsCommandToMQTT(capability, command, args, config) {
    switch (capability) {
      case 'switch':
        if (command === 'on' || command === 'off') {
          return {
            action: 'gpio',
            pin: config.control_pin || 2,
            state: command
          };
        }
        break;

      case 'switchLevel':
        if (command === 'setLevel') {
          return {
            action: 'pwm',
            pin: config.control_pin || 2,
            value: Math.round((args[0] / 100) * 255)
          };
        }
        break;

      case 'fanSpeed':
        if (command === 'setFanSpeed') {
          const speedMap = { low: 85, medium: 170, high: 255 };
          return {
            action: 'pwm',
            pin: config.control_pin || 2,
            value: speedMap[args[0]] || 255
          };
        }
        break;

      case 'thermostatSetpoint':
        if (command === 'setHeatingSetpoint' || command === 'setCoolingSetpoint') {
          return {
            action: 'thermostat',
            target_temperature: args[0]
          };
        }
        break;

      default:
        console.warn(`❌ Unsupported SmartThings capability: ${capability}.${command}`);
        return null;
    }

    return null;
  }

  async createDeviceInSmartThings(accessToken, device) {
    try {
      const deviceConfig = device.config ? JSON.parse(device.config) : {};
      const deviceType = deviceConfig.smartthings_type || 'switch';

      const deviceData = {
        label: device.name,
        deviceTypeName: this.deviceTypes[deviceType] || this.deviceTypes.switch,
        deviceTypeId: 'iot-platform-device',
        deviceNetworkId: device.device_id,
        capabilities: this.capabilities[deviceType] || this.capabilities.switch,
        metadata: {
          deviceId: device.device_id,
          userId: device.user_id,
          deviceType: deviceType
        }
      };

      const response = await axios.post(
        `${this.apiBaseUrl}/devices`,
        deviceData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`✅ Device created in SmartThings: ${response.data.deviceId}`);
      return response.data;

    } catch (error) {
      console.error('❌ Error creating device in SmartThings:', error);
      throw error;
    }
  }

  async updateDeviceState(accessToken, deviceId, capability, attribute, value) {
    try {
      const eventData = {
        deviceEvents: [
          {
            deviceId,
            capability,
            attribute,
            value,
            unit: null,
            data: null
          }
        ]
      };

      await axios.post(
        `${this.apiBaseUrl}/devices/events`,
        eventData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`✅ Device state updated in SmartThings: ${deviceId}`);

    } catch (error) {
      console.error('❌ Error updating device state in SmartThings:', error);
      throw error;
    }
  }
}

// Create singleton instance
const smartThingsService = new SmartThingsService();

module.exports = smartThingsService;
