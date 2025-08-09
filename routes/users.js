const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');

const router = express.Router();

// Validation rules
const updateProfileValidation = [
  body('first_name').optional().trim().isLength({ min: 1 }).withMessage('First name cannot be empty'),
  body('last_name').optional().trim().isLength({ min: 1 }).withMessage('Last name cannot be empty'),
  body('phone').optional().isMobilePhone().withMessage('Please provide a valid phone number')
];

const changePasswordValidation = [
  body('current_password').notEmpty().withMessage('Current password is required'),
  body('new_password').isLength({ min: 6 }).withMessage('New password must be at least 6 characters long'),
  body('confirm_password').custom((value, { req }) => {
    if (value !== req.body.new_password) {
      throw new Error('Password confirmation does not match');
    }
    return true;
  })
];

/**
 * @swagger
 * /api/users/profile:
 *   get:
 *     summary: Get user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 */
router.get('/profile', async (req, res) => {
  try {
    const users = await db.query(`
      SELECT 
        id, email, first_name, last_name, phone, avatar_url,
        is_active, email_verified, last_login, created_at,
        (SELECT COUNT(*) FROM devices WHERE user_id = users.id) as device_count
      FROM users 
      WHERE id = ?
    `, [req.user.id]);

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        user: users[0]
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/users/profile:
 *   put:
 *     summary: Update user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 */
router.put('/profile', updateProfileValidation, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { first_name, last_name, phone } = req.body;
    const updateFields = [];
    const updateValues = [];

    if (first_name !== undefined) {
      updateFields.push('first_name = ?');
      updateValues.push(first_name);
    }
    if (last_name !== undefined) {
      updateFields.push('last_name = ?');
      updateValues.push(last_name);
    }
    if (phone !== undefined) {
      updateFields.push('phone = ?');
      updateValues.push(phone);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    updateValues.push(req.user.id);

    await db.query(
      `UPDATE users SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`,
      updateValues
    );

    // Get updated user
    const users = await db.query(
      'SELECT id, email, first_name, last_name, phone, avatar_url, is_active, email_verified, last_login, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: users[0]
      }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/users/change-password:
 *   post:
 *     summary: Change user password
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - current_password
 *               - new_password
 *               - confirm_password
 *             properties:
 *               current_password:
 *                 type: string
 *               new_password:
 *                 type: string
 *               confirm_password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password changed successfully
 */
router.post('/change-password', changePasswordValidation, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { current_password, new_password } = req.body;

    // Get current user with password
    const users = await db.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
    
    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(current_password, users[0].password);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const hashedNewPassword = await bcrypt.hash(new_password, saltRounds);

    // Update password
    await db.query(
      'UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?',
      [hashedNewPassword, req.user.id]
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/users/dashboard:
 *   get:
 *     summary: Get user dashboard data
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard data retrieved successfully
 */
router.get('/dashboard', async (req, res) => {
  try {
    // Get device statistics
    const deviceStats = await db.query(`
      SELECT 
        COUNT(*) as total_devices,
        SUM(CASE WHEN is_online = true THEN 1 ELSE 0 END) as online_devices,
        SUM(CASE WHEN is_online = false THEN 1 ELSE 0 END) as offline_devices
      FROM devices 
      WHERE user_id = ?
    `, [req.user.id]);

    // Get recent device data
    const recentData = await db.query(`
      SELECT 
        d.name as device_name,
        dd.data_type,
        dd.sensor_name,
        dd.value,
        dd.unit,
        dd.timestamp
      FROM device_data dd
      JOIN devices d ON dd.device_id = d.id
      WHERE d.user_id = ?
      ORDER BY dd.timestamp DESC
      LIMIT 10
    `, [req.user.id]);

    // Get recent commands
    const recentCommands = await db.query(`
      SELECT 
        d.name as device_name,
        dc.command,
        dc.status,
        dc.created_at
      FROM device_commands dc
      JOIN devices d ON dc.device_id = d.id
      WHERE dc.user_id = ?
      ORDER BY dc.created_at DESC
      LIMIT 5
    `, [req.user.id]);

    // Get smart home integrations
    const integrations = await db.query(`
      SELECT platform, is_active, created_at
      FROM smart_home_integrations
      WHERE user_id = ?
    `, [req.user.id]);

    res.json({
      success: true,
      data: {
        deviceStats: deviceStats[0],
        recentData,
        recentCommands,
        integrations
      }
    });

  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
