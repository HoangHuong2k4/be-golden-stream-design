module.exports = {
  apps: [
    {
      name: "be",
      script: "./server.js",
      env: {
        // Sử dụng 127.0.0.1 để ép kết nối qua TCP, tránh lỗi Unix Socket
        // Password đã được URL-encode các ký tự đặc biệt (; -> %3B, @ -> %40)
        DATABASE_URL: "mysql://huong_moneywin:CP%3B1%40IK8xL0FHp6k@localhost/huong_moneywin?socket=/var/run/mysqld/mysqld.sock&connection_limit=20",
        PRISMA_CLIENT_ENGINE_TYPE: "library",
        JWT_SECRET: "phh_jwt_secret_2026_moneywin",
        PORT: 3010,
        NODE_ENV: "production"
      },
      max_memory_restart: "500M",
      exp_backoff_restart_delay: 100
    }
    // Bạn có thể thêm cấu hình 'fe' vào đây nếu chạy frontend bằng PM2
  ]
}
