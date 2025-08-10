const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const UserModel = require('../models/userModel');

const UserController = {
  async getProfile(req, res) {
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

  async updateProfile(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const { first_name, last_name, phone } = req.body;
      const result = await UserModel.updateProfile(req.user.id, { first_name, last_name, phone });
      if (result.affectedRows === 0) {
        return res.status(400).json({ success: false, message: 'No fields to update' });
      }

      const users = await UserModel.findPublicById(req.user.id);
      res.json({ success: true, message: 'Profile updated successfully', data: { user: users[0] } });
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  async changePassword(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const { current_password, new_password } = req.body;
      const users = await UserModel.findById(req.user.id);
      if (users.length === 0) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const isCurrentPasswordValid = await bcrypt.compare(current_password, users[0].password);
      if (!isCurrentPasswordValid) {
        return res.status(400).json({ success: false, message: 'Current password is incorrect' });
      }

      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
      const hashedNewPassword = await bcrypt.hash(new_password, saltRounds);
      await UserModel.updatePassword(req.user.id, hashedNewPassword);

      res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  async getDashboard(req, res) {
    try {
      const { deviceStats, recentData, recentCommands, integrations } = await UserModel.getDashboardStats(req.user.id);
      res.json({ success: true, data: { deviceStats, recentData, recentCommands, integrations } });
    } catch (error) {
      console.error('Get dashboard error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
};

module.exports = UserController; 