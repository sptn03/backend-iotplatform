const DataModel = require('../models/dataModel');

const DataController = {
  async getSensorData(req, res) {
    try {
      const { limit = 100, offset = 0, sensor_name, start_date, end_date } = req.query;
      const { sensorData, total } = await DataModel.getSensorData(req.params.deviceId, {
        limit,
        offset,
        sensor_name,
        start_date,
        end_date
      });

      res.json({
        success: true,
        data: {
          sensorData,
          pagination: {
            total,
            limit: parseInt(limit),
            offset: parseInt(offset),
            hasMore: (parseInt(offset) + parseInt(limit)) < total
          }
        }
      });
    } catch (error) {
      console.error('Get sensor data error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  async getCommands(req, res) {
    try {
      const { limit = 50, offset = 0, status } = req.query;
      const { commands, total } = await DataModel.getCommands(req.params.deviceId, { limit, offset, status });

      res.json({
        success: true,
        data: {
          commands,
          pagination: {
            total,
            limit: parseInt(limit),
            offset: parseInt(offset),
            hasMore: (parseInt(offset) + parseInt(limit)) < total
          }
        }
      });
    } catch (error) {
      console.error('Get command history error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  async getAnalytics(req, res) {
    try {
      const { period = 'day', sensor_name } = req.query;
      const { analytics, sensorSummary } = await DataModel.getAnalytics(req.params.deviceId, { period, sensor_name });
      res.json({ success: true, data: { analytics, sensorSummary, period } });
    } catch (error) {
      console.error('Get analytics error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  async exportCsv(req, res) {
    try {
      const { start_date, end_date, data_type = 'sensor' } = req.query;
      // For now keep original export logic in route. This controller placeholder can be expanded later.
      res.status(501).json({ success: false, message: 'Not implemented in controller yet' });
    } catch (error) {
      console.error('Export data error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
};

module.exports = DataController; 