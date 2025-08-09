const axios = require('axios');
const colors = require('colors');

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

class BackendTester {
  constructor() {
    this.token = null;
    this.testUser = {
      email: 'test@iotplatform.com',
      password: 'test123456',
      first_name: 'Test',
      last_name: 'User'
    };
    this.testDevice = {
      device_id: 'ESP32_TEST_123',
      name: 'Test Device',
      description: 'Test ESP32 device for backend testing'
    };
  }

  async runTests() {
    console.log('🧪 IoT Platform Backend Testing'.cyan.bold);
    console.log('================================\n'.cyan);

    try {
      await this.testHealthCheck();
      await this.testAuthentication();
      await this.testDeviceManagement();
      await this.testDataEndpoints();
      await this.testSmartHomeEndpoints();
      await this.testIFTTTEndpoints();
      
      console.log('\n✅ All tests passed!'.green.bold);
    } catch (error) {
      console.error('\n❌ Tests failed:'.red.bold, error.message);
      process.exit(1);
    }
  }

  async testHealthCheck() {
    console.log('🏥 Testing Health Check...'.yellow);
    
    try {
      const response = await axios.get(`${BASE_URL}/health`);
      
      if (response.status === 200 && response.data.status === 'OK') {
        console.log('✅ Health check passed'.green);
      } else {
        throw new Error('Health check failed');
      }
    } catch (error) {
      throw new Error(`Health check failed: ${error.message}`);
    }
  }

  async testAuthentication() {
    console.log('\n🔐 Testing Authentication...'.yellow);

    // Test registration
    try {
      const registerResponse = await axios.post(`${BASE_URL}/api/auth/register`, this.testUser);
      
      if (registerResponse.status === 201 && registerResponse.data.success) {
        console.log('✅ User registration passed'.green);
        this.token = registerResponse.data.data.token;
      } else {
        throw new Error('Registration failed');
      }
    } catch (error) {
      if (error.response?.status === 400 && error.response.data.message.includes('already exists')) {
        console.log('ℹ️ User already exists, testing login...'.blue);
        
        // Test login
        const loginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
          email: this.testUser.email,
          password: this.testUser.password
        });
        
        if (loginResponse.status === 200 && loginResponse.data.success) {
          console.log('✅ User login passed'.green);
          this.token = loginResponse.data.data.token;
        } else {
          throw new Error('Login failed');
        }
      } else {
        throw new Error(`Authentication failed: ${error.message}`);
      }
    }

    // Test protected endpoint
    try {
      const meResponse = await axios.get(`${BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${this.token}` }
      });
      
      if (meResponse.status === 200 && meResponse.data.success) {
        console.log('✅ Protected endpoint access passed'.green);
      } else {
        throw new Error('Protected endpoint access failed');
      }
    } catch (error) {
      throw new Error(`Protected endpoint test failed: ${error.message}`);
    }
  }

  async testDeviceManagement() {
    console.log('\n📱 Testing Device Management...'.yellow);

    const headers = { Authorization: `Bearer ${this.token}` };

    // Test device registration
    try {
      const registerResponse = await axios.post(`${BASE_URL}/api/devices`, this.testDevice, { headers });
      
      if (registerResponse.status === 201 && registerResponse.data.success) {
        console.log('✅ Device registration passed'.green);
        this.deviceId = registerResponse.data.data.device.id;
      } else {
        throw new Error('Device registration failed');
      }
    } catch (error) {
      if (error.response?.status === 400 && error.response.data.message.includes('already exists')) {
        console.log('ℹ️ Device already exists, getting device list...'.blue);
        
        const devicesResponse = await axios.get(`${BASE_URL}/api/devices`, { headers });
        const existingDevice = devicesResponse.data.data.devices.find(d => d.device_id === this.testDevice.device_id);
        
        if (existingDevice) {
          this.deviceId = existingDevice.id;
          console.log('✅ Device found in list'.green);
        } else {
          throw new Error('Device not found in list');
        }
      } else {
        throw new Error(`Device registration failed: ${error.message}`);
      }
    }

    // Test device list
    try {
      const listResponse = await axios.get(`${BASE_URL}/api/devices`, { headers });
      
      if (listResponse.status === 200 && listResponse.data.success) {
        console.log('✅ Device list passed'.green);
      } else {
        throw new Error('Device list failed');
      }
    } catch (error) {
      throw new Error(`Device list test failed: ${error.message}`);
    }

    // Test device details
    try {
      const detailResponse = await axios.get(`${BASE_URL}/api/devices/${this.deviceId}`, { headers });
      
      if (detailResponse.status === 200 && detailResponse.data.success) {
        console.log('✅ Device details passed'.green);
      } else {
        throw new Error('Device details failed');
      }
    } catch (error) {
      throw new Error(`Device details test failed: ${error.message}`);
    }
  }

  async testDataEndpoints() {
    console.log('\n📊 Testing Data Endpoints...'.yellow);

    const headers = { Authorization: `Bearer ${this.token}` };

    // Test sensor data endpoint
    try {
      const sensorResponse = await axios.get(`${BASE_URL}/api/data/sensors/${this.deviceId}`, { headers });
      
      if (sensorResponse.status === 200 && sensorResponse.data.success) {
        console.log('✅ Sensor data endpoint passed'.green);
      } else {
        throw new Error('Sensor data endpoint failed');
      }
    } catch (error) {
      throw new Error(`Sensor data test failed: ${error.message}`);
    }

    // Test commands endpoint
    try {
      const commandsResponse = await axios.get(`${BASE_URL}/api/data/commands/${this.deviceId}`, { headers });
      
      if (commandsResponse.status === 200 && commandsResponse.data.success) {
        console.log('✅ Commands endpoint passed'.green);
      } else {
        throw new Error('Commands endpoint failed');
      }
    } catch (error) {
      throw new Error(`Commands test failed: ${error.message}`);
    }

    // Test analytics endpoint
    try {
      const analyticsResponse = await axios.get(`${BASE_URL}/api/data/analytics/${this.deviceId}`, { headers });
      
      if (analyticsResponse.status === 200 && analyticsResponse.data.success) {
        console.log('✅ Analytics endpoint passed'.green);
      } else {
        throw new Error('Analytics endpoint failed');
      }
    } catch (error) {
      throw new Error(`Analytics test failed: ${error.message}`);
    }
  }

  async testSmartHomeEndpoints() {
    console.log('\n🏠 Testing Smart Home Endpoints...'.yellow);

    const headers = { Authorization: `Bearer ${this.token}` };

    // Test integrations list
    try {
      const integrationsResponse = await axios.get(`${BASE_URL}/api/smart-home/integrations`, { headers });
      
      if (integrationsResponse.status === 200 && integrationsResponse.data.success) {
        console.log('✅ Smart home integrations endpoint passed'.green);
      } else {
        throw new Error('Smart home integrations endpoint failed');
      }
    } catch (error) {
      throw new Error(`Smart home integrations test failed: ${error.message}`);
    }
  }

  async testIFTTTEndpoints() {
    console.log('\n🔗 Testing IFTTT Endpoints...'.yellow);

    const headers = { Authorization: `Bearer ${this.token}` };

    // Test IFTTT status
    try {
      const statusResponse = await axios.get(`${BASE_URL}/api/ifttt/status`);
      
      if (statusResponse.status === 200 && statusResponse.data.status === 'ok') {
        console.log('✅ IFTTT status endpoint passed'.green);
      } else {
        throw new Error('IFTTT status endpoint failed');
      }
    } catch (error) {
      throw new Error(`IFTTT status test failed: ${error.message}`);
    }

    // Test IFTTT user info
    try {
      const userInfoResponse = await axios.get(`${BASE_URL}/api/ifttt/user/info`, { headers });
      
      if (userInfoResponse.status === 200 && userInfoResponse.data.data) {
        console.log('✅ IFTTT user info endpoint passed'.green);
      } else {
        throw new Error('IFTTT user info endpoint failed');
      }
    } catch (error) {
      throw new Error(`IFTTT user info test failed: ${error.message}`);
    }

    // Test IFTTT test setup
    try {
      const testSetupResponse = await axios.post(`${BASE_URL}/api/ifttt/test/setup`, {
        samples: {}
      });
      
      if (testSetupResponse.status === 200 && testSetupResponse.data.data) {
        console.log('✅ IFTTT test setup endpoint passed'.green);
      } else {
        throw new Error('IFTTT test setup endpoint failed');
      }
    } catch (error) {
      throw new Error(`IFTTT test setup test failed: ${error.message}`);
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new BackendTester();
  tester.runTests().catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
}

module.exports = BackendTester;
