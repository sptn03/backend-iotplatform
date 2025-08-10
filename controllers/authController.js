const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const UserModel = require('../models/userModel');
const TokenModel = require('../models/tokenModel');

function getExpiresAtFromJwt(token) {
  const decoded = jwt.decode(token);
  if (!decoded || !decoded.exp) return null;
  return new Date(decoded.exp * 1000);
}

function generateShortId() {
  const prefix = 'NZ03';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rnd = '';
  for (let i = 0; i < 4; i++) {
    rnd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return prefix + rnd;
}

const generateToken = (userId) => {
  const expiresIn = process.env.JWT_EXPIRES_IN;
  if (expiresIn && expiresIn.trim() !== '') {
    return jwt.sign(
      { userId },
      process.env.JWT_SECRET,
      { expiresIn }
    );
  }
  // No expiry configured -> issue token without exp claim
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET
  );
};

function getAppRole(req) {
  return (req.body && req.body.app_role) || req.get('X-App-Role') || 'web';
}

const AuthController = {
  async register(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const { email, password, first_name, last_name, phone } = req.body;

      if (await UserModel.existsByEmail(email)) {
        return res.status(400).json({ success: false, message: 'User with this email already exists' });
      }

      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      let shortId;
      for (let i = 0; i < 5; i++) {
        shortId = generateShortId();
        const exists = await UserModel.existsByShortId(shortId);
        if (!exists) break;
        shortId = null;
      }
      if (!shortId) {
        return res.status(500).json({ success: false, message: 'Could not generate unique short ID' });
      }

      const result = await UserModel.create({ email, password: hashedPassword, first_name, last_name, phone, short_id: shortId });
      const userId = result.insertId;

      const token = generateToken(userId);
      const expiresAt = getExpiresAtFromJwt(token); // may be null
      const appRole = getAppRole(req);
      await TokenModel.createTokenRecord({
        userId,
        token,
        appRole,
        expiresAt,
        userAgent: req.get('User-Agent'),
        ipAddress: req.ip
      });
      const users = await UserModel.findPublicById(userId);

      res.status(201).json({ success: true, message: 'User registered successfully', data: { user: users[0], token } });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ success: false, message: 'Internal server error during registration' });
    }
  },

  async login(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const { email, password } = req.body;
      const users = await UserModel.findByEmail(email);
      if (users.length === 0) {
        return res.status(401).json({ success: false, message: 'Invalid email or password' });
      }

      const user = users[0];

      if (!user.is_active) {
        return res.status(401).json({ success: false, message: 'Account is deactivated. Please contact support.' });
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ success: false, message: 'Invalid email or password' });
      }

      await UserModel.updateLastLogin(user.id);
      const token = generateToken(user.id);
      const expiresAt = getExpiresAtFromJwt(token); // may be null
      const appRole = getAppRole(req);

      // Enforce single active per app_role for role 'user'
      if (user.role !== 'admin') {
        await TokenModel.revokeActiveTokensByAppRole(user.id, appRole);
      }

      await TokenModel.createTokenRecord({
        userId: user.id,
        token,
        appRole,
        expiresAt,
        userAgent: req.get('User-Agent'),
        ipAddress: req.ip
      });
      delete user.password;

      res.json({ success: true, message: 'Login successful', data: { user, token } });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ success: false, message: 'Internal server error during login' });
    }
  },

  async me(req, res) {
    try {
      const users = await UserModel.findPublicById(req.user.id);
      if (users.length === 0) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      res.json({ success: true, data: { user: users[0] } });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  async refresh(req, res) {
    try {
      const token = generateToken(req.user.id);
      const expiresAt = getExpiresAtFromJwt(token); // may be null
      const appRole = getAppRole(req);

      // Enforce single active per app_role for role 'user'
      if (req.user.role !== 'admin') {
        await TokenModel.revokeActiveTokensByAppRole(req.user.id, appRole);
      }

      await TokenModel.createTokenRecord({
        userId: req.user.id,
        token,
        appRole,
        expiresAt,
        userAgent: req.get('User-Agent'),
        ipAddress: req.ip
      });
      res.json({ success: true, message: 'Token refreshed successfully', data: { token } });
    } catch (error) {
      console.error('Token refresh error:', error);
      res.status(500).json({ success: false, message: 'Internal server error during token refresh' });
    }
  },

  async logout(req, res) {
    try {
      if (!req.user || !req.token) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
      }
      await TokenModel.revokeToken({ userId: req.user.id, token: req.token });
      res.json({ success: true, message: 'Logout successful' });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ success: false, message: 'Internal server error during logout' });
    }
  }
};

module.exports = AuthController; 