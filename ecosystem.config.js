module.exports = {
  apps: [
    {
      name: "ecommerce-api",
      script: "./server.js",
      instances: "max", // Utilize all CPU cores
      exec_mode: "cluster",
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },
      watch: false,
      max_memory_restart: "1G", // Prevent memory leaks from hanging the server
      error_file: "logs/err.log",
      out_file: "logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm Z",
    },
  ],
};
