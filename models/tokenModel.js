const db = require('../config/database');

const TokenModel = {
  async createTokenRecord({ userId, token, expiresAt, userAgent, ipAddress, appRole }) {
    return db.query(
      `INSERT INTO user_tokens (user_id, token, app_role, expires_at, user_agent, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, token, appRole || null, expiresAt, userAgent || null, ipAddress || null]
    );
  },

  async getTokenRecord({ userId, token }) {
    const rows = await db.query(
      `SELECT id, user_id, token, app_role, revoked, expires_at, revoked_at
       FROM user_tokens
       WHERE user_id = ? AND token = ?
       LIMIT 1`,
      [userId, token]
    );
    return rows.length > 0 ? rows[0] : null;
  },

  async isTokenActive({ userId, token }) {
    const rows = await db.query(
      `SELECT id
       FROM user_tokens
       WHERE user_id = ? AND token = ? AND revoked = false AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [userId, token]
    );
    return rows.length > 0;
  },

  async revokeToken({ userId, token }) {
    return db.query(
      `UPDATE user_tokens
       SET revoked = true, revoked_at = NOW()
       WHERE user_id = ? AND token = ? AND revoked = false`,
      [userId, token]
    );
  },

  async revokeAllForUser(userId) {
    return db.query(
      `UPDATE user_tokens
       SET revoked = true, revoked_at = NOW()
       WHERE user_id = ? AND revoked = false`,
      [userId]
    );
  },

  async revokeActiveTokensByAppRole(userId, appRole) {
    return db.query(
      `UPDATE user_tokens
       SET revoked = true, revoked_at = NOW()
       WHERE user_id = ? AND app_role = ? AND revoked = false AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId, appRole]
    );
  }
};

module.exports = TokenModel; 