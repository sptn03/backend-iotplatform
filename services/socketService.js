const jwt = require('jsonwebtoken');
const db = require('../config/database');

class SocketService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map();
  }

  initialize(io) {
    this.io = io;

    // Authentication middleware for Socket.IO
    io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        
        if (!token) {
          return next(new Error('Authentication error: No token provided'));
        }

        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Get user from database
        const users = await db.query(
          'SELECT id, email, first_name, last_name FROM users WHERE id = ? AND is_active = true',
          [decoded.userId]
        );

        if (users.length === 0) {
          return next(new Error('Authentication error: User not found'));
        }

        socket.user = users[0];
        next();

      } catch (error) {
        console.error('Socket authentication error:', error);
        next(new Error('Authentication error: Invalid token'));
      }
    });

    // Handle connections
    io.on('connection', (socket) => {
      this.handleConnection(socket);
    });

    console.log('✅ Socket.IO service initialized');
  }

  handleConnection(socket) {
    const userId = socket.user.id;
    
    console.log(`👤 User ${socket.user.email} connected (Socket ID: ${socket.id})`);

    // Store user connection
    if (!this.connectedUsers.has(userId)) {
      this.connectedUsers.set(userId, new Set());
    }
    this.connectedUsers.get(userId).add(socket.id);

    // Join user to their personal room
    socket.join(`user_${userId}`);

    // Join user to their device rooms
    this.joinUserDeviceRooms(socket, userId);

    // Handle device subscription
    socket.on('subscribe_device', (deviceId) => {
      this.handleDeviceSubscription(socket, deviceId);
    });

    // Handle device unsubscription
    socket.on('unsubscribe_device', (deviceId) => {
      this.handleDeviceUnsubscription(socket, deviceId);
    });

    // Handle real-time device control
    socket.on('device_command', (data) => {
      this.handleDeviceCommand(socket, data);
    });

    // Handle ping/pong for connection health
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      this.handleDisconnection(socket, reason);
    });

    // Send initial connection success
    socket.emit('connected', {
      message: 'Connected successfully',
      user: {
        id: socket.user.id,
        email: socket.user.email,
        name: `${socket.user.first_name} ${socket.user.last_name}`
      },
      timestamp: new Date().toISOString()
    });
  }

  async joinUserDeviceRooms(socket, userId) {
    try {
      // Get user's devices
      const devices = await db.query(`
        SELECT device_id FROM devices 
        WHERE user_id = ? OR id IN (
          SELECT device_id FROM device_sharing 
          WHERE shared_with_id = ? AND is_active = true
        )
      `, [userId, userId]);

      // Join device rooms
      devices.forEach(device => {
        socket.join(`device_${device.device_id}`);
      });

      console.log(`📱 User ${socket.user.email} joined ${devices.length} device rooms`);

    } catch (error) {
      console.error('Error joining device rooms:', error);
    }
  }

  async handleDeviceSubscription(socket, deviceId) {
    try {
      // Verify user has access to device
      const devices = await db.query(`
        SELECT d.id, d.device_id, d.name
        FROM devices d
        LEFT JOIN device_sharing ds ON d.id = ds.device_id AND ds.shared_with_id = ? AND ds.is_active = true
        WHERE d.device_id = ? AND (d.user_id = ? OR ds.id IS NOT NULL)
      `, [socket.user.id, deviceId, socket.user.id]);

      if (devices.length === 0) {
        socket.emit('error', {
          message: 'Access denied to device',
          deviceId
        });
        return;
      }

      // Join device room
      socket.join(`device_${deviceId}`);
      
      // Send current device status
      const deviceStatus = await this.getDeviceStatus(deviceId);
      socket.emit('device_status', {
        deviceId,
        status: deviceStatus
      });

      console.log(`📱 User ${socket.user.email} subscribed to device ${deviceId}`);

    } catch (error) {
      console.error('Device subscription error:', error);
      socket.emit('error', {
        message: 'Failed to subscribe to device',
        deviceId
      });
    }
  }

  handleDeviceUnsubscription(socket, deviceId) {
    socket.leave(`device_${deviceId}`);
    console.log(`📱 User ${socket.user.email} unsubscribed from device ${deviceId}`);
  }

  async handleDeviceCommand(socket, data) {
    try {
      const { deviceId, command } = data;

      // Verify user has access to device
      const devices = await db.query(`
        SELECT d.id, d.device_id, d.name
        FROM devices d
        LEFT JOIN device_sharing ds ON d.id = ds.device_id AND ds.shared_with_id = ? AND ds.is_active = true
        WHERE d.device_id = ? AND (d.user_id = ? OR ds.id IS NOT NULL)
      `, [socket.user.id, deviceId, socket.user.id]);

      if (devices.length === 0) {
        socket.emit('error', {
          message: 'Access denied to device',
          deviceId
        });
        return;
      }

      // Send command via MQTT (assuming mqttService is available)
      const mqttService = require('./mqttService');
      const commandWithUser = {
        ...command,
        userId: socket.user.id,
        timestamp: new Date().toISOString()
      };

      const result = await mqttService.sendDeviceCommand(deviceId, commandWithUser);

      // Emit command sent confirmation
      socket.emit('command_sent', {
        deviceId,
        commandId: result.commandId,
        command: commandWithUser
      });

      // Broadcast to other users watching this device
      socket.to(`device_${deviceId}`).emit('device_command_sent', {
        deviceId,
        command: commandWithUser,
        sentBy: {
          id: socket.user.id,
          name: `${socket.user.first_name} ${socket.user.last_name}`
        }
      });

      console.log(`🎮 User ${socket.user.email} sent command to device ${deviceId}`);

    } catch (error) {
      console.error('Device command error:', error);
      socket.emit('error', {
        message: 'Failed to send device command',
        error: error.message
      });
    }
  }

  handleDisconnection(socket, reason) {
    const userId = socket.user.id;
    
    console.log(`👤 User ${socket.user.email} disconnected (Reason: ${reason})`);

    // Remove socket from user connections
    if (this.connectedUsers.has(userId)) {
      this.connectedUsers.get(userId).delete(socket.id);
      
      // If no more connections for this user, remove from map
      if (this.connectedUsers.get(userId).size === 0) {
        this.connectedUsers.delete(userId);
      }
    }
  }

  async getDeviceStatus(deviceId) {
    try {
      const devices = await db.query(`
        SELECT is_online, last_seen, ip_address
        FROM devices
        WHERE device_id = ?
      `, [deviceId]);

      if (devices.length === 0) {
        return null;
      }

      const device = devices[0];

      // Get latest sensor data
      const sensorData = await db.query(`
        SELECT sensor_name, value, unit, timestamp
        FROM device_data
        WHERE device_id = (SELECT id FROM devices WHERE device_id = ?) 
        AND data_type = 'sensor'
        ORDER BY timestamp DESC
        LIMIT 5
      `, [deviceId]);

      return {
        online: device.is_online,
        lastSeen: device.last_seen,
        ipAddress: device.ip_address,
        sensorData
      };

    } catch (error) {
      console.error('Get device status error:', error);
      return null;
    }
  }

  // Public methods for broadcasting events

  broadcastToUser(userId, event, data) {
    if (this.io) {
      this.io.to(`user_${userId}`).emit(event, data);
    }
  }

  broadcastToDevice(deviceId, event, data) {
    if (this.io) {
      this.io.to(`device_${deviceId}`).emit(event, data);
    }
  }

  broadcastDeviceUpdate(deviceId, data) {
    this.broadcastToDevice(deviceId, 'device_update', {
      deviceId,
      data,
      timestamp: new Date().toISOString()
    });
  }

  broadcastSensorData(deviceId, sensorData) {
    this.broadcastToDevice(deviceId, 'sensor_data', {
      deviceId,
      sensorData,
      timestamp: new Date().toISOString()
    });
  }

  broadcastCommandResponse(deviceId, commandResponse) {
    this.broadcastToDevice(deviceId, 'command_response', {
      deviceId,
      response: commandResponse,
      timestamp: new Date().toISOString()
    });
  }

  broadcastDeviceStatus(deviceId, status) {
    this.broadcastToDevice(deviceId, 'device_status', {
      deviceId,
      status,
      timestamp: new Date().toISOString()
    });
  }

  getConnectedUsersCount() {
    return this.connectedUsers.size;
  }

  getConnectedSocketsCount() {
    let totalSockets = 0;
    this.connectedUsers.forEach(sockets => {
      totalSockets += sockets.size;
    });
    return totalSockets;
  }

  isUserConnected(userId) {
    return this.connectedUsers.has(userId);
  }
}

// Create singleton instance
const socketService = new SocketService();

module.exports = socketService;
