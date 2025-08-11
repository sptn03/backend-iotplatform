const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'IoT Platform API',
      version: '1.0.0',
      description: 'A comprehensive IoT platform API for managing ESP32 devices with smart home integrations',
      contact: {
        name: 'IoT Platform Team',
        email: 'support@iotplatform.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: process.env.API_BASE_URL || 'http://localhost:3000',
        description: 'Development server'
      },
      {
        url: 'http://n8n.nz03.com:3000',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter JWT token'
        }
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'User ID'
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address'
            },
            first_name: {
              type: 'string',
              description: 'User first name'
            },
            last_name: {
              type: 'string',
              description: 'User last name'
            },
            phone: {
              type: 'string',
              description: 'User phone number'
            },
            avatar_url: {
              type: 'string',
              description: 'User avatar URL'
            },
            is_active: {
              type: 'boolean',
              description: 'User active status'
            },
            email_verified: {
              type: 'boolean',
              description: 'Email verification status'
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Account creation timestamp'
            }
          }
        },
        Device: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'Device database ID'
            },
            device_id: {
              type: 'string',
              description: 'Unique device identifier'
            },
            user_id: {
              type: 'integer',
              description: 'Owner user ID'
            },
            name: {
              type: 'string',
              description: 'Device name'
            },
            description: {
              type: 'string',
              description: 'Device description'
            },
            device_type: {
              type: 'string',
              description: 'Device type (ESP32, etc.)'
            },
            firmware_version: {
              type: 'string',
              description: 'Firmware version'
            },
            mac_address: {
              type: 'string',
              description: 'Device MAC address'
            },
            ip_address: {
              type: 'string',
              description: 'Device IP address'
            },
            location: {
              type: 'string',
              description: 'Device location'
            },
            room: {
              type: 'string',
              description: 'Device room'
            },
            is_online: {
              type: 'boolean',
              description: 'Device online status'
            },
            last_seen: {
              type: 'string',
              format: 'date-time',
              description: 'Last seen timestamp'
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Device registration timestamp'
            }
          }
        },
        SensorData: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'Data record ID'
            },
            device_id: {
              type: 'integer',
              description: 'Device database ID'
            },
            data_type: {
              type: 'string',
              description: 'Type of data (sensor, command, etc.)'
            },
            sensor_name: {
              type: 'string',
              description: 'Sensor name'
            },
            value: {
              type: 'number',
              description: 'Sensor value'
            },
            unit: {
              type: 'string',
              description: 'Value unit'
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: 'Data timestamp'
            }
          }
        },
        Command: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'Command ID'
            },
            device_id: {
              type: 'integer',
              description: 'Device database ID'
            },
            user_id: {
              type: 'integer',
              description: 'User who sent the command'
            },
            command: {
              type: 'object',
              description: 'Command JSON data'
            },
            status: {
              type: 'string',
              enum: ['pending', 'sent', 'acknowledged', 'failed'],
              description: 'Command status'
            },
            response: {
              type: 'object',
              description: 'Command response JSON data'
            },
            sent_at: {
              type: 'string',
              format: 'date-time',
              description: 'Command sent timestamp'
            },
            acknowledged_at: {
              type: 'string',
              format: 'date-time',
              description: 'Command acknowledged timestamp'
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Command created timestamp'
            }
          }
        },
        SmartHomeIntegration: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'Integration ID'
            },
            user_id: {
              type: 'integer',
              description: 'User ID'
            },
            platform: {
              type: 'string',
              enum: ['google_home', 'alexa', 'smartthings'],
              description: 'Smart home platform'
            },
            platform_user_id: {
              type: 'string',
              description: 'Platform-specific user ID'
            },
            is_active: {
              type: 'boolean',
              description: 'Integration active status'
            },
            settings: {
              type: 'object',
              description: 'Platform-specific settings'
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Integration created timestamp'
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            message: {
              type: 'string',
              description: 'Error message'
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: {
                    type: 'string'
                  },
                  message: {
                    type: 'string'
                  }
                }
              },
              description: 'Validation errors'
            }
          }
        },
        Success: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            message: {
              type: 'string',
              description: 'Success message'
            },
            data: {
              type: 'object',
              description: 'Response data'
            }
          }
        }
      },
      responses: {
        UnauthorizedError: {
          description: 'Authentication information is missing or invalid',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        ValidationError: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        NotFoundError: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        InternalServerError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        }
      }
    },
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication and authorization'
      },
      {
        name: 'Users',
        description: 'User management and profile operations'
      },
      {
        name: 'Devices',
        description: 'IoT device management and control'
      },
      {
        name: 'Data',
        description: 'Sensor data and analytics'
      },
      {
        name: 'Smart Home',
        description: 'Smart home platform integrations'
      }
    ]
  },
  apis: [
    './routes/*.js', // Path to the API routes
    './models/*.js'  // Path to the models (if any)
  ]
};

const specs = swaggerJsdoc(options);

module.exports = specs;
