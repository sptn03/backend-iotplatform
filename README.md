# IoT Platform Backend

Backend API cho hệ thống IoT Platform được xây dựng với Node.js, Express, MySQL và MQTT.

## 🚀 Tính năng

- ✅ **Authentication & Authorization**: JWT-based authentication
- ✅ **Device Management**: CRUD operations cho IoT devices
- ✅ **Real-time Communication**: WebSocket và MQTT integration
- ✅ **Data Analytics**: Sensor data collection và analytics
- ✅ **Smart Home Integration**: Google Home, Alexa, SmartThings
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
GET    /api/devices           # Danh sách devices của user
POST   /api/devices           # Đăng ký device mới
GET    /api/devices/:id       # Chi tiết device
PUT    /api/devices/:id       # Cập nhật device
DELETE /api/devices/:id       # Xóa device
POST   /api/devices/:id/command    # Gửi lệnh tới device
GET    /api/devices/:id/status     # Lấy trạng thái device
```

### Data
```
GET    /api/data/sensors/:deviceId     # Dữ liệu sensor
GET    /api/data/commands/:deviceId    # Lịch sử commands
GET    /api/data/analytics/:deviceId   # Analytics data
GET    /api/data/export/:deviceId      # Export CSV
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

Backend tự động kết nối tới MQTT broker và:

- **Subscribe** tới tất cả device response topics: `resp/[DeviceID]`
- **Publish** commands tới device command topics: `cmd/[DeviceID]`
- **Lưu trữ** tất cả sensor data vào database
- **Broadcast** real-time updates qua WebSocket

### MQTT Message Format

#### Command (Backend → Device)
```json
{
  "action": "gpio",
  "pin": 2,
  "state": "on",
  "userId": "user123",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

#### Response (Device → Backend)
```json
{
  "type": "sensor_data",
  "device_id": "ESP32_ABC123",
  "user_id": "user123",
  "sensors": [
    {
      "name": "temperature",
      "value": 25.6,
      "unit": "°C"
    }
  ],
  "timestamp": "2024-01-15T10:30:00Z"
}
```

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
