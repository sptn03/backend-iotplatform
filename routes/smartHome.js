const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const mqttService = require('../services/mqttService');
const googleHomeService = require('../services/googleHomeService');
const alexaService = require('../services/alexaService');
const smartThingsService = require('../services/smartThingsService');

const router = express.Router();

/**
 * @swagger
 * /api/smart-home/integrations:
 *   get:
 *     summary: Get user's smart home integrations
 *     tags: [Smart Home]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Integrations retrieved successfully
 */
router.get('/integrations', async (req, res) => {
  try {
    const integrations = await db.query(`
      SELECT 
        id, platform, platform_user_id, is_active, 
        settings, created_at, updated_at
      FROM smart_home_integrations
      WHERE user_id = ?
      ORDER BY created_at DESC
    `, [req.user.id]);

    res.json({
      success: true,
      data: {
        integrations
      }
    });

  } catch (error) {
    console.error('Get integrations error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/smart-home/google/auth:
 *   post:
 *     summary: Setup Google Home integration
 *     tags: [Smart Home]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - access_token
 *             properties:
 *               access_token:
 *                 type: string
 *               refresh_token:
 *                 type: string
 *               expires_in:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Google Home integration setup successfully
 */
router.post('/google/auth', async (req, res) => {
  try {
    const { access_token, refresh_token, expires_in } = req.body;

    if (!access_token) {
      return res.status(400).json({
        success: false,
        message: 'Access token is required'
      });
    }

    const expiresAt = expires_in ? 
      new Date(Date.now() + expires_in * 1000) : 
      new Date(Date.now() + 3600 * 1000); // Default 1 hour

    // Upsert integration
    await db.query(`
      INSERT INTO smart_home_integrations 
      (user_id, platform, access_token, refresh_token, token_expires_at, is_active)
      VALUES (?, 'google_home', ?, ?, ?, true)
      ON DUPLICATE KEY UPDATE
      access_token = VALUES(access_token),
      refresh_token = VALUES(refresh_token),
      token_expires_at = VALUES(token_expires_at),
      is_active = true,
      updated_at = NOW()
    `, [req.user.id, access_token, refresh_token || null, expiresAt]);

    res.json({
      success: true,
      message: 'Google Home integration setup successfully'
    });

  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/smart-home/google/fulfill:
 *   post:
 *     summary: Google Assistant fulfillment endpoint
 *     tags: [Smart Home]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Fulfillment response
 */
router.post('/google/fulfill', async (req, res) => {
  try {
    const { inputs, requestId } = req.body;
    
    if (!inputs || !Array.isArray(inputs)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request format'
      });
    }

    const input = inputs[0];
    const intent = input.intent;

    let response = {
      requestId,
      payload: {}
    };

    switch (intent) {
      case 'action.devices.SYNC':
        response.payload = await handleGoogleSync(req.user.id);
        break;
      
      case 'action.devices.QUERY':
        response.payload = await handleGoogleQuery(input.payload.devices);
        break;
      
      case 'action.devices.EXECUTE':
        response.payload = await handleGoogleExecute(input.payload.commands);
        break;
      
      default:
        return res.status(400).json({
          success: false,
          message: 'Unknown intent'
        });
    }

    res.json(response);

  } catch (error) {
    console.error('Google fulfill error:', error);
    res.status(500).json({
      requestId: req.body.requestId,
      payload: {
        errorCode: 'hardError'
      }
    });
  }
});

async function handleGoogleSync(userId) {
  return await googleHomeService.handleSync(userId);
}

async function handleGoogleQuery(devices) {
  return await googleHomeService.handleQuery(devices);
}

async function handleGoogleExecute(commands) {
  return await googleHomeService.handleExecute(commands);
}

/**
 * @swagger
 * /api/smart-home/alexa/auth:
 *   post:
 *     summary: Setup Alexa integration
 *     tags: [Smart Home]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - access_token
 *             properties:
 *               access_token:
 *                 type: string
 *               refresh_token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Alexa integration setup successfully
 */
router.post('/alexa/auth', async (req, res) => {
  try {
    const { access_token, refresh_token } = req.body;

    if (!access_token) {
      return res.status(400).json({
        success: false,
        message: 'Access token is required'
      });
    }

    // Upsert integration
    await db.query(`
      INSERT INTO smart_home_integrations 
      (user_id, platform, access_token, refresh_token, is_active)
      VALUES (?, 'alexa', ?, ?, true)
      ON DUPLICATE KEY UPDATE
      access_token = VALUES(access_token),
      refresh_token = VALUES(refresh_token),
      is_active = true,
      updated_at = NOW()
    `, [req.user.id, access_token, refresh_token || null]);

    res.json({
      success: true,
      message: 'Alexa integration setup successfully'
    });

  } catch (error) {
    console.error('Alexa auth error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/smart-home/alexa/directive:
 *   post:
 *     summary: Alexa directive handler
 *     tags: [Smart Home]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Directive response
 */
router.post('/alexa/directive', async (req, res) => {
  try {
    const { directive } = req.body;

    if (!directive) {
      return res.status(400).json({
        success: false,
        message: 'Invalid directive format'
      });
    }

    const namespace = directive.header.namespace;
    const name = directive.header.name;

    let response;

    if (namespace === 'Alexa.Discovery' && name === 'Discover') {
      // Extract user ID from access token (you'll need to implement this)
      const userId = req.user?.id || 1; // Fallback for testing
      const discoveryResponse = await alexaService.handleDiscovery(userId);

      response = {
        event: {
          header: {
            namespace: 'Alexa.Discovery',
            name: 'Discover.Response',
            payloadVersion: '3',
            messageId: alexaService.generateMessageId()
          },
          payload: discoveryResponse
        }
      };
    } else {
      // Handle other directives
      response = await alexaService.handleDirective(directive);
    }

    res.json(response);

  } catch (error) {
    console.error('Alexa directive error:', error);
    res.status(500).json({
      event: {
        header: {
          namespace: 'Alexa',
          name: 'ErrorResponse',
          payloadVersion: '3',
          messageId: 'error-' + Date.now()
        },
        payload: {
          type: 'INTERNAL_ERROR',
          message: 'Internal server error'
        }
      }
    });
  }
});

/**
 * @swagger
 * /api/smart-home/smartthings/webhook:
 *   post:
 *     summary: SmartThings webhook endpoint
 *     tags: [Smart Home]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 */
router.post('/smartthings/webhook', async (req, res) => {
  try {
    const response = await smartThingsService.handleWebhook(req);
    res.json(response);
  } catch (error) {
    console.error('SmartThings webhook error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/smart-home/smartthings/auth:
 *   post:
 *     summary: Setup SmartThings integration
 *     tags: [Smart Home]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - access_token
 *             properties:
 *               access_token:
 *                 type: string
 *               refresh_token:
 *                 type: string
 *     responses:
 *       200:
 *         description: SmartThings integration setup successfully
 */
router.post('/smartthings/auth', async (req, res) => {
  try {
    const { access_token, refresh_token } = req.body;

    if (!access_token) {
      return res.status(400).json({
        success: false,
        message: 'Access token is required'
      });
    }

    // Upsert integration
    await db.query(`
      INSERT INTO smart_home_integrations
      (user_id, platform, access_token, refresh_token, is_active)
      VALUES (?, 'smartthings', ?, ?, true)
      ON DUPLICATE KEY UPDATE
      access_token = VALUES(access_token),
      refresh_token = VALUES(refresh_token),
      is_active = true,
      updated_at = NOW()
    `, [req.user.id, access_token, refresh_token || null]);

    res.json({
      success: true,
      message: 'SmartThings integration setup successfully'
    });

  } catch (error) {
    console.error('SmartThings auth error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
