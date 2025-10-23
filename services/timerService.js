const cron = require('node-cron');
const TimerModel = require('../models/timerModel');
const mqttService = require('./mqttService');
const db = require('../config/database');

const scheduledTasks = new Map();

const TimerService = {
  async start() {
    console.log('Starting TimerService...');
    const timers = await TimerModel.getAllEnabledTimers();
    for (const timer of timers) {
      this.scheduleTimer(timer);
    }
  },

  scheduleTimer(timer) {
    if (scheduledTasks.has(timer.id)) {
      this.cancelTimer(timer.id);
    }

    const task = cron.schedule(timer.cron_expression, async () => {
      console.log(`Executing timer: ${timer.name}`);
      try {
        const device = await TimerModel.getDeviceForTimer(timer.id);
        if (!device) {
          console.error(`Device not found for timer: ${timer.name}`);
          return;
        }

        const { board_id, gpio_pin, action, value } = device;
        let desiredStateBool = undefined;

        if (action === 'turn_on') desiredStateBool = true;
        else if (action === 'turn_off') desiredStateBool = false;
        else if (action === 'toggle') {
          const current = device.state ? (typeof device.state === 'string' ? JSON.parse(device.state) : device.state) : { state: false };
          desiredStateBool = !Boolean(current.state);
        }

        if (device.device_type === 'dimmer' && value !== null) {
          await mqttService.sendCommand(board_id, 'pwm', { pin: gpio_pin, value });
        } else if (typeof desiredStateBool === 'boolean') {
          const fwState = desiredStateBool ? 'on' : 'off';
          await mqttService.sendCommand(board_id, 'gpio', { pin: gpio_pin, state: fwState });
          await db.query(
            `UPDATE devices SET state = JSON_SET(COALESCE(state, JSON_OBJECT()), '$.state', ?), updated_at = CURRENT_TIMESTAMP WHERE device_id = ?`,
            [desiredStateBool, device.device_id]
          );
        }
      } catch (error) {
        console.error(`Error executing timer ${timer.name}:`, error);
      }
    });

    scheduledTasks.set(timer.id, task);
    console.log(`Timer scheduled: ${timer.name}`);
  },

  cancelTimer(timerId) {
    if (scheduledTasks.has(timerId)) {
      const task = scheduledTasks.get(timerId);
      task.stop();
      scheduledTasks.delete(timerId);
      console.log(`Timer canceled: ${timerId}`);
    }
  }
};

module.exports = TimerService;
