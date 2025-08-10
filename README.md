# IoT Platform Backend

Backend API cho hệ thống IoT Platform được xây dựng với Node.js, Express, MySQL và MQTT.

This backend uses JWT for authentication. Tokens are persisted in `user_tokens` table to enable server-side revocation and expiry checks. Middleware validates that a token is both cryptographically valid and active in the database.

- Issue token: on register/login/refresh a row is inserted into `user_tokens` with `expires_at`.
- Validate token: every protected route checks `user_tokens` for `revoked = false` and `expires_at > NOW()`.
- Logout: current token is marked revoked, immediately invalidating it.

## 🚀 Tính năng

- ✅ **Authentication & Authorization**: JWT-based authentication
- ✅ **Device Management**: CRUD operations cho IoT devices
- ✅ **Real-time Communication**: WebSocket và MQTT integration
- ✅ **Data Analytics**: Sensor data collection và analytics
- ✅ **Smart Home Integration (Tùy chọn)**: Google Home, Alexa, SmartThings (đang tạm tắt trong cấu hình mặc định)
- ✅ **API Documentation**: Swagger/OpenAPI documentation
- ✅ **Security**: Rate limiting, input validation, error handling

## 📋 Yêu cầu hệ thống

- Node.js >= 16.0.0
- MySQL >= 8.0
- MQTT Broker (Mosquitto recommended)
- Redis (optional, for caching)

## 🛠️ Cài đặt

### 1. Clone repository và cài đặt dependencies

```bash
cd backend
npm install
```

### 2. Cấu hình environment variables

```bash
cp .env.example .env
```

Chỉnh sửa file `.env` với thông tin của bạn:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_NAME=iot_platform
DB_USER=root
DB_PASSWORD=your_password

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d

# MQTT Configuration
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_USERNAME=
MQTT_PASSWORD=
MQTT_CLIENT_ID=iot-platform-backend
```

### 3. Tạo database và chạy migrations

```bash
# Tạo database và tables
npm run migrate

# (Optional) Seed sample data
npm run seed
```

### 4. Khởi động server

```bash
# Development mode với auto-reload
npm run dev

# Production mode
npm start
```

## 📚 API Documentation

> Lưu ý: Trừ các endpoint `/api/auth/*`, tất cả các endpoint khác yêu cầu JWT Bearer Token trong header `Authorization: Bearer <token>`.

Sau khi khởi động server, truy cập:

- **API Documentation**: http://localhost:3000/api-docs
- **Health Check**: http://localhost:3000/health

## 🔧 API Endpoints

### Authentication
```
POST   /api/auth/register     # Đăng ký user mới
POST   /api/auth/login        # Đăng nhập
GET    /api/auth/me           # Lấy thông tin user hiện tại
POST   /api/auth/refresh      # Refresh JWT token
POST   /api/auth/logout       # Đăng xuất
```

### Users
```
GET    /api/users/profile     # Lấy profile user
PUT    /api/users/profile     # Cập nhật profile
POST   /api/users/change-password  # Đổi mật khẩu
GET    /api/users/dashboard   # Lấy dashboard data
```

### Devices
```
# Device APIs
GET    /api/devices                    # Danh sách devices của user
POST   /api/devices                    # Thêm device (sau khi ESP32 đã config)
PUT    /api/devices/:deviceId          # Cập nhật device (tên, config)
DELETE /api/devices/:deviceId          # Xóa device (soft delete)
POST   /api/devices/:deviceId/control  # Điều khiển device (gpio/pwm)
GET    /api/devices/:deviceId/data     # Lịch sử data của device

# Boards (ESP32) APIs
GET    /api/devices/boards             # Danh sách ESP32 boards của user
GET    /api/devices/boards/:boardId    # Chi tiết board + devices
PUT    /api/devices/boards/:boardId    # Cập nhật thông tin board (name/location)
```

### Data
```
GET    /api/data/sensors/:deviceId     # Dữ liệu sensor (phân trang, filter theo sensor_name, thời gian)
GET    /api/data/commands/:deviceId    # Lịch sử lệnh (trạng thái: pending/sent/acknowledged/failed)
GET    /api/data/analytics/:deviceId   # Tổng hợp (avg/min/max, group theo hour/day/week/month)
GET    /api/data/export/:deviceId      # Export CSV (sensor/status/command)
```

### Smart Home
```
GET    /api/smart-home/integrations    # Danh sách integrations
POST   /api/smart-home/google/auth     # Google Home OAuth
POST   /api/smart-home/google/fulfill  # Google Assistant fulfillment
POST   /api/smart-home/alexa/auth      # Alexa OAuth
POST   /api/smart-home/alexa/directive # Alexa directive handler
```

## 🔌 MQTT Integration

Backend sử dụng mô hình 2-topic đơn giản (tham khảo `firmware/examples/mqtt_simple_commands.md`):

- Publish lệnh: `cmd/{deviceId}`
- Subscribe phản hồi & dữ liệu: `resp/{deviceId}` (tất cả: ack, gpio_change, sensor, heartbeat, errors)

### Gửi lệnh (Backend → Device)
```json
{
  "action": "gpio",
  "pin": 2,
  "state": "on"
}
```

### Phản hồi chuẩn (Device → Backend)
```json
{
  "status": "success",
  "action": "gpio",
  "details": {
    "pin": 2,
    "state": "HIGH",
    "message": "GPIO 2 turned on"
  },
  "timestamp": 1704108645
}
```

### Theo dõi ACK theo commandId (áp dụng cho add_device/update_device/gpio/pwm)
- Backend gửi lệnh qua `mqttService.sendCommand(...)` và `waitForAck(...)`.
- Firmware phản hồi `type: "ack"` kèm `commandId` và `success` để xác nhận.
- Nếu quá thời gian `timeoutMs`, backend trả lỗi 408.


## 🌐 WebSocket Events

### Client → Server
```javascript
// Kết nối với JWT token
socket.auth = { token: 'your-jwt-token' };

// Subscribe tới device updates
socket.emit('subscribe_device', 'ESP32_ABC123');

// Gửi command tới device
socket.emit('device_command', {
  deviceId: 'ESP32_ABC123',
  command: { action: 'gpio', pin: 2, state: 'on' }
});

// Ping để kiểm tra connection
socket.emit('ping');
```

### Server → Client
```javascript
// Kết nối thành công
socket.on('connected', (data) => {
  console.log('Connected:', data.user);
});

// Real-time sensor data
socket.on('sensor_data', (data) => {
  console.log('Sensor data:', data.sensorData);
});

// Device status updates
socket.on('device_status', (data) => {
  console.log('Device status:', data.status);
});

// Command responses
socket.on('command_response', (data) => {
  console.log('Command response:', data.response);
});

// Pong response
socket.on('pong', (data) => {
  console.log('Latency:', Date.now() - data.timestamp);
});
```

## 🧪 Testing

```bash
# Chạy unit tests
npm test

# Chạy tests với coverage
npm run test:coverage

# Chạy integration tests
npm run test:integration
```

## 🐳 Docker Deployment

```bash
# Build Docker image
docker build -t iot-platform-backend .

# Chạy với docker-compose
docker-compose up -d
```

## 📊 Monitoring

### Health Check
```bash
curl http://localhost:3000/health
```

### Metrics
- **API Response Times**: Tracked via Morgan logging
- **Database Connections**: MySQL connection pool monitoring
- **MQTT Messages**: Message throughput tracking
- **WebSocket Connections**: Active connection count

## 🔒 Security

### Authentication
- **JWT Tokens**: Secure user authentication
- **Password Hashing**: bcrypt với salt rounds
- **Rate Limiting**: API request limiting
- **Input Validation**: express-validator

### Data Protection
- **CORS**: Cross-origin request protection
- **Helmet**: Security headers
- **SQL Injection**: Parameterized queries
- **XSS Protection**: Input sanitization

## 🚀 Performance

### Optimization
- **Connection Pooling**: MySQL connection pooling
- **Compression**: Gzip compression
- **Caching**: Redis caching (optional)
- **Clustering**: PM2 cluster mode

### Scaling
- **Load Balancing**: Nginx/HAProxy
- **Database Clustering**: MySQL master-slave
- **MQTT Clustering**: Mosquitto cluster
- **Horizontal Scaling**: Multiple backend instances

## 📝 Logging

Logs được lưu tại:
- **Console**: Development mode
- **File**: Production mode (`./logs/app.log`)
- **Format**: Combined format với timestamp

## 🤝 Contributing

1. Fork repository
2. Tạo feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Tạo Pull Request

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

## 📞 Support

- **Email**: support@iotplatform.com
- **Documentation**: http://localhost:3000/api-docs
- **Issues**: GitHub Issues
