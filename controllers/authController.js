const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const UserModel = require('../models/userModel');

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
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

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
      res.json({ success: true, message: 'Token refreshed successfully', data: { token } });
    } catch (error) {
      console.error('Token refresh error:', error);
      res.status(500).json({ success: false, message: 'Internal server error during token refresh' });
    }
  },

  async logout(req, res) {
    res.json({ success: true, message: 'Logout successful. Please remove the token from client storage.' });
  }
};

module.exports = AuthController; 