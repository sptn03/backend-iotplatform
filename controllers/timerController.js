const TimerModel = require('../models/timerModel');
const timerService = require('../services/timerService');

const TimerController = {
  async getTimers(req, res) {
    try {
      const timers = await TimerModel.getTimersByUser(req.user.id);
      res.json({ success: true, data: timers });
    } catch (error) {
      console.error('Error fetching timers:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch timers' });
    }
  },

  async createTimer(req, res) {
    try {
      const timer = { ...req.body, user_id: req.user.id };
      const timerId = await TimerModel.createTimer(timer);
      const newTimer = await TimerModel.getTimerById(timerId, req.user.id);
      timerService.scheduleTimer(newTimer);
      res.status(201).json({ success: true, message: 'Timer created successfully', data: newTimer });
    } catch (error) {
      console.error('Error creating timer:', error);
      res.status(500).json({ success: false, message: 'Failed to create timer' });
    }
  },

  async getTimerById(req, res) {
    try {
      const timer = await TimerModel.getTimerById(req.params.id, req.user.id);
      if (!timer) return res.status(404).json({ success: false, message: 'Timer not found' });
      res.json({ success: true, data: timer });
    } catch (error) {
      console.error('Error fetching timer:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch timer' });
    }
  },

  async updateTimer(req, res) {
    try {
      const timer = { ...req.body };
      await TimerModel.updateTimer(req.params.id, timer, req.user.id);
      const updatedTimer = await TimerModel.getTimerById(req.params.id, req.user.id);
      timerService.scheduleTimer(updatedTimer);
      res.json({ success: true, message: 'Timer updated successfully', data: updatedTimer });
    } catch (error) {
      console.error('Error updating timer:', error);
      res.status(500).json({ success: false, message: 'Failed to update timer' });
    }
  },

  async deleteTimer(req, res) {
    try {
      await TimerModel.deleteTimer(req.params.id, req.user.id);
      timerService.cancelTimer(req.params.id);
      res.json({ success: true, message: 'Timer deleted successfully' });
    } catch (error) {
      console.error('Error deleting timer:', error);
      res.status(500).json({ success: false, message: 'Failed to delete timer' });
    }
  }
};

module.exports = TimerController;
