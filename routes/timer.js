const express = require('express');
const { authMiddleware: auth } = require('../middleware/auth');
const TimerController = require('../controllers/timerController');

const router = express.Router();

router.get('/', auth, TimerController.getTimers);
router.post('/', auth, TimerController.createTimer);
router.get('/:id', auth, TimerController.getTimerById);
router.put('/:id', auth, TimerController.updateTimer);
router.delete('/:id', auth, TimerController.deleteTimer);

module.exports = router;
