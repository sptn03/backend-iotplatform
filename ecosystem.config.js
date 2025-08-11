// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'iot-back',
      cwd: '/root/backend_iot',    // thư mục chạy app trên VPS
      script: 'server.js',         // file start chính
      instances: 1,                 // hoặc 'max' nếu muốn cluster
      exec_mode: 'fork',            // hoặc 'cluster'
      watch: false,                 // tắt watch trong production
      env: {
        NODE_ENV: 'production'
      },
      error_file: '/root/backend_iot/logs/err.log', // file log lỗi
      out_file: '/root/backend_iot/logs/out.log',   // file log output
      time: true                                    // log kèm timestamp
    }
  ]
}
