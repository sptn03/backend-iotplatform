const jwt = require('jsonwebtoken');
const db = require('../config/database');

const authMiddleware = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided or invalid format.'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database
    const users = await db.query(
      'SELECT id, email, first_name, last_name, is_active FROM users WHERE id = ? AND is_active = true',
      [decoded.userId]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token. User not found or inactive.'
      });
    }

    // Add user to request object
    req.user = users[0];
    next();

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired.'
      });
    }

    console.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during authentication.'
    });
  }
};

// Optional auth middleware - doesn't fail if no token
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const users = await db.query(
      'SELECT id, email, first_name, last_name, is_active FROM users WHERE id = ? AND is_active = true',
      [decoded.userId]
    );

    req.user = users.length > 0 ? users[0] : null;
    next();

  } catch (error) {
    // If token is invalid, just continue without user
    req.user = null;
    next();
  }
};

// Admin middleware
const adminMiddleware = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });
    }

    // Check if user is admin (you can implement your own admin logic)
    const adminUsers = await db.query(
      'SELECT id FROM users WHERE id = ? AND email IN (SELECT email FROM admin_users)',
      [req.user.id]
    );

    if (adminUsers.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required.'
      });
    }

    next();

  } catch (error) {
    console.error('Admin middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during admin check.'
    });
  }
};

// Device owner middleware
const deviceOwnerMiddleware = async (req, res, next) => {
  try {
    const deviceId = req.params.deviceId || req.body.deviceId;
    
    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message: 'Device ID is required.'
      });
    }

    // Check if user owns the device or has shared access
    const devices = await db.query(`
      SELECT d.id, d.user_id, d.name
      FROM devices d
      LEFT JOIN device_sharing ds ON d.id = ds.device_id AND ds.shared_with_id = ? AND ds.is_active = true
      WHERE d.id = ? AND (d.user_id = ? OR ds.id IS NOT NULL)
    `, [req.user.id, deviceId, req.user.id]);

    if (devices.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to access this device.'
      });
    }

    req.device = devices[0];
    next();

  } catch (error) {
    console.error('Device owner middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during device access check.'
    });
  }
};

module.exports = {
  authMiddleware,
  optionalAuth,
  adminMiddleware,
  deviceOwnerMiddleware
};
