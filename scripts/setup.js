const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function setupEnvironment() {
  console.log('🚀 IoT Platform Backend Setup');
  console.log('================================\n');

  // Check if .env exists
  const envPath = path.join(__dirname, '..', '.env');
  const envExamplePath = path.join(__dirname, '..', '.env.example');

  if (!fs.existsSync(envPath)) {
    console.log('📝 Creating .env file from template...');
    fs.copyFileSync(envExamplePath, envPath);
    console.log('✅ .env file created\n');
  }

  // Get database configuration
  console.log('🗄️ Database Configuration');
  console.log('-------------------------');
  
  const dbHost = await question('Database Host (localhost): ') || 'localhost';
  const dbPort = await question('Database Port (3306): ') || '3306';
  const dbName = await question('Database Name (iot_platform): ') || 'iot_platform';
  const dbUser = await question('Database User (root): ') || 'root';
  const dbPassword = await question('Database Password: ');

  // Get JWT secret
  console.log('\n🔐 Security Configuration');
  console.log('-------------------------');
  
  const jwtSecret = await question('JWT Secret (press Enter to generate): ') || generateRandomString(64);

  // Get MQTT configuration
  console.log('\n📡 MQTT Configuration');
  console.log('---------------------');
  
  const mqttBroker = await question('MQTT Broker URL (mqtt://localhost:1883): ') || 'mqtt://localhost:1883';
  const mqttUsername = await question('MQTT Username (optional): ') || '';
  const mqttPassword = await question('MQTT Password (optional): ') || '';

  // Update .env file
  console.log('\n📝 Updating .env file...');
  updateEnvFile(envPath, {
    DB_HOST: dbHost,
    DB_PORT: dbPort,
    DB_NAME: dbName,
    DB_USER: dbUser,
    DB_PASSWORD: dbPassword,
    JWT_SECRET: jwtSecret,
    MQTT_BROKER_URL: mqttBroker,
    MQTT_USERNAME: mqttUsername,
    MQTT_PASSWORD: mqttPassword
  });

  console.log('✅ .env file updated\n');

  // Install dependencies
  console.log('📦 Installing dependencies...');
  try {
    execSync('npm install', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    console.log('✅ Dependencies installed\n');
  } catch (error) {
    console.error('❌ Failed to install dependencies:', error.message);
    process.exit(1);
  }

  // Create database and run migrations
  const runMigrations = await question('🗄️ Run database migrations? (y/N): ');
  if (runMigrations.toLowerCase() === 'y' || runMigrations.toLowerCase() === 'yes') {
    console.log('🗄️ Running database migrations...');
    try {
      execSync('npm run migrate', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
      console.log('✅ Database migrations completed\n');
    } catch (error) {
      console.error('❌ Failed to run migrations:', error.message);
      console.log('💡 You can run migrations later with: npm run migrate\n');
    }
  }

  // Create directories
  console.log('📁 Creating directories...');
  const directories = ['logs', 'uploads', 'temp'];
  directories.forEach(dir => {
    const dirPath = path.join(__dirname, '..', dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`✅ Created directory: ${dir}`);
    }
  });

  console.log('\n🎉 Setup completed successfully!');
  console.log('\n📋 Next steps:');
  console.log('1. Start the server: npm run dev');
  console.log('2. Visit API docs: http://localhost:3000/api-docs');
  console.log('3. Check health: http://localhost:3000/health');
  console.log('\n💡 Tips:');
  console.log('- Use npm run dev for development with auto-reload');
  console.log('- Use npm start for production');
  console.log('- Check logs in ./logs/app.log');

  rl.close();
}

function updateEnvFile(envPath, config) {
  let envContent = fs.readFileSync(envPath, 'utf8');

  Object.entries(config).forEach(([key, value]) => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const replacement = `${key}=${value}`;
    
    if (envContent.match(regex)) {
      envContent = envContent.replace(regex, replacement);
    } else {
      envContent += `\n${replacement}`;
    }
  });

  fs.writeFileSync(envPath, envContent);
}

function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n👋 Setup cancelled by user');
  rl.close();
  process.exit(0);
});

// Run setup
if (require.main === module) {
  setupEnvironment().catch(error => {
    console.error('❌ Setup failed:', error);
    rl.close();
    process.exit(1);
  });
}

module.exports = { setupEnvironment };
