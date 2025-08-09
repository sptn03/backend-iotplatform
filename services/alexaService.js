const db = require('../config/database');
const mqttService = require('./mqttService');

class AlexaService {
  constructor() {
    this.deviceTypes = {
      'light': 'LIGHT',
      'switch': 'SWITCH',
      'outlet': 'SMARTPLUG',
      'fan': 'FAN',
      'thermostat': 'THERMOSTAT',
      'sensor': 'TEMPERATURE_SENSOR'
    };

    this.capabilities = {
      'light': [
        'Alexa.PowerController',
        'Alexa.BrightnessController',
        'Alexa.EndpointHealth'
      ],
      'switch': [
        'Alexa.PowerController',
        'Alexa.EndpointHealth'
      ],
      'outlet': [
        'Alexa.PowerController',
        'Alexa.EndpointHealth'
      ],
      'fan': [
        'Alexa.PowerController',
        'Alexa.RangeController',
        'Alexa.EndpointHealth'
      ],
      'thermostat': [
        'Alexa.ThermostatController',
        'Alexa.TemperatureSensor',
        'Alexa.EndpointHealth'
      ],
      'sensor': [
        'Alexa.TemperatureSensor',
        'Alexa.EndpointHealth'
      ]
    };
  }

  async handleDiscovery(userId) {
    try {
      console.log(`🔍 Alexa Discovery request for user ${userId}`);

      // Get user's devices
      const devices = await db.query(`
        SELECT device_id, name, description, room, device_type, config, is_online
        FROM devices
        WHERE user_id = ?
        ORDER BY name
      `, [userId]);

      const alexaEndpoints = devices.map(device => {
        const deviceConfig = device.config ? JSON.parse(device.config) : {};
        const deviceType = deviceConfig.alexa_type || 'switch';

        return {
          endpointId: device.device_id,
          manufacturerName: 'IoT Platform',
          friendlyName: device.name,
          description: device.description || `Smart ${deviceType} controlled by ESP32`,
          displayCategories: [this.deviceTypes[deviceType] || this.deviceTypes.switch],
          capabilities: this.buildCapabilities(deviceType, deviceConfig),
          additionalAttributes: {
            manufacturer: 'IoT Platform',
            model: device.device_type || 'ESP32',
            serialNumber: device.device_id,
            firmwareVersion: '2.0.0',
            softwareVersion: '2.0.0',
            customIdentifier: device.device_id
          }
        };
      });

      console.log(`✅ Discovery response: ${alexaEndpoints.length} endpoints`);

      return {
        endpoints: alexaEndpoints
      };

    } catch (error) {
      console.error('❌ Alexa Discovery error:', error);
      throw error;
    }
  }

  async handleDirective(directive) {
    try {
      const { header, endpoint, payload } = directive;
      const { namespace, name } = header;
      const endpointId = endpoint.endpointId;

      console.log(`⚡ Alexa Directive: ${namespace}.${name} for ${endpointId}`);

      // Get device from database
      const devices = await db.query(`
        SELECT id, device_id, user_id, name, config
        FROM devices
        WHERE device_id = ?
      `, [endpointId]);

      if (devices.length === 0) {
        throw new Error('Device not found');
      }

      const device = devices[0];
      const deviceConfig = device.config ? JSON.parse(device.config) : {};

      let response;

      switch (namespace) {
        case 'Alexa.PowerController':
          response = await this.handlePowerController(device, name, payload, deviceConfig);
          break;
        case 'Alexa.BrightnessController':
          response = await this.handleBrightnessController(device, name, payload, deviceConfig);
          break;
        case 'Alexa.RangeController':
          response = await this.handleRangeController(device, name, payload, deviceConfig);
          break;
        case 'Alexa.ThermostatController':
          response = await this.handleThermostatController(device, name, payload, deviceConfig);
          break;
        default:
          throw new Error(`Unsupported namespace: ${namespace}`);
      }

      // Build response
      return {
        event: {
          header: {
            namespace: 'Alexa',
            name: 'Response',
            payloadVersion: '3',
            messageId: this.generateMessageId(),
            correlationToken: header.correlationToken
          },
          endpoint: {
            scope: endpoint.scope,
            endpointId: endpointId
          },
          payload: {}
        },
        context: {
          properties: response.properties || []
        }
      };

    } catch (error) {
      console.error('❌ Alexa Directive error:', error);
      
      return {
        event: {
          header: {
            namespace: 'Alexa',
            name: 'ErrorResponse',
            payloadVersion: '3',
            messageId: this.generateMessageId()
          },
          payload: {
            type: 'INTERNAL_ERROR',
            message: error.message
          }
        }
      };
    }
  }

  async handlePowerController(device, name, payload, config) {
    const powerState = name === 'TurnOn' ? 'ON' : 'OFF';
    
    // Send MQTT command
    const mqttCommand = {
      action: 'gpio',
      pin: config.control_pin || 2,
      state: powerState === 'ON' ? 'on' : 'off',
      source: 'alexa',
      userId: device.user_id,
      timestamp: new Date().toISOString()
    };

    await mqttService.sendDeviceCommand(device.device_id, mqttCommand);

    return {
      properties: [
        {
          namespace: 'Alexa.PowerController',
          name: 'powerState',
          value: powerState,
          timeOfSample: new Date().toISOString(),
          uncertaintyInMilliseconds: 500
        }
      ]
    };
  }

  async handleBrightnessController(device, name, payload, config) {
    let brightness;

    switch (name) {
      case 'SetBrightness':
        brightness = payload.brightness;
        break;
      case 'AdjustBrightness':
        // Get current brightness from database or assume 50%
        brightness = Math.max(0, Math.min(100, 50 + payload.brightnessDelta));
        break;
      default:
        throw new Error(`Unsupported brightness command: ${name}`);
    }

    // Send MQTT command
    const mqttCommand = {
      action: 'pwm',
      pin: config.control_pin || 2,
      value: Math.round((brightness / 100) * 255),
      source: 'alexa',
      userId: device.user_id,
      timestamp: new Date().toISOString()
    };

    await mqttService.sendDeviceCommand(device.device_id, mqttCommand);

    return {
      properties: [
        {
          namespace: 'Alexa.BrightnessController',
          name: 'brightness',
          value: brightness,
          timeOfSample: new Date().toISOString(),
          uncertaintyInMilliseconds: 500
        }
      ]
    };
  }

  async handleRangeController(device, name, payload, config) {
    let rangeValue;

    switch (name) {
      case 'SetRangeValue':
        rangeValue = payload.rangeValue;
        break;
      case 'AdjustRangeValue':
        // Get current value from database or assume 50
        rangeValue = Math.max(0, Math.min(100, 50 + payload.rangeValueDelta));
        break;
      default:
        throw new Error(`Unsupported range command: ${name}`);
    }

    // Send MQTT command (for fan speed control)
    const mqttCommand = {
      action: 'pwm',
      pin: config.control_pin || 2,
      value: Math.round((rangeValue / 100) * 255),
      source: 'alexa',
      userId: device.user_id,
      timestamp: new Date().toISOString()
    };

    await mqttService.sendDeviceCommand(device.device_id, mqttCommand);

    return {
      properties: [
        {
          namespace: 'Alexa.RangeController',
          instance: 'FanSpeed',
          name: 'rangeValue',
          value: rangeValue,
          timeOfSample: new Date().toISOString(),
          uncertaintyInMilliseconds: 500
        }
      ]
    };
  }

  async handleThermostatController(device, name, payload, config) {
    let targetTemperature;

    switch (name) {
      case 'SetTargetTemperature':
        targetTemperature = payload.targetSetpoint.value;
        break;
      case 'AdjustTargetTemperature':
        // Get current target from database or assume 22°C
        targetTemperature = 22 + payload.targetSetpointDelta.value;
        break;
      default:
        throw new Error(`Unsupported thermostat command: ${name}`);
    }

    // Send MQTT command
    const mqttCommand = {
      action: 'thermostat',
      target_temperature: targetTemperature,
      source: 'alexa',
      userId: device.user_id,
      timestamp: new Date().toISOString()
    };

    await mqttService.sendDeviceCommand(device.device_id, mqttCommand);

    return {
      properties: [
        {
          namespace: 'Alexa.ThermostatController',
          name: 'targetSetpoint',
          value: {
            value: targetTemperature,
            scale: 'CELSIUS'
          },
          timeOfSample: new Date().toISOString(),
          uncertaintyInMilliseconds: 500
        }
      ]
    };
  }

  buildCapabilities(deviceType, config) {
    const capabilities = [];
    const deviceCapabilities = this.capabilities[deviceType] || this.capabilities.switch;

    for (const capability of deviceCapabilities) {
      const capabilityObj = {
        type: 'AlexaInterface',
        interface: capability,
        version: '3'
      };

      // Add specific configurations for certain capabilities
      if (capability === 'Alexa.RangeController') {
        capabilityObj.instance = 'FanSpeed';
        capabilityObj.capabilityResources = {
          friendlyNames: [
            { '@type': 'text', value: { text: 'Speed', locale: 'en-US' } },
            { '@type': 'text', value: { text: 'Fan Speed', locale: 'en-US' } }
          ]
        };
        capabilityObj.configuration = {
          supportedRange: { minimumValue: 0, maximumValue: 100, precision: 1 },
          unitOfMeasure: 'Alexa.Unit.Percent'
        };
      }

      capabilities.push(capabilityObj);
    }

    return capabilities;
  }

  generateMessageId() {
    return 'msg-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now();
  }
}

// Create singleton instance
const alexaService = new AlexaService();

module.exports = alexaService;
