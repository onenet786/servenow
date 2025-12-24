const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const config = {
    development: {
        app: {
            port: process.env.PORT || 3002,
            env: 'development',
            logLevel: 'debug'
        },
        database: {
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'servenow',
            port: process.env.DB_PORT || 3306,
            connectionLimit: 5,
            debug: true
        },
        security: {
            corsOrigin: true,
            sessionSecret: process.env.JWT_SECRET || 'dev-secret-key',
            jwtExpire: process.env.JWT_EXPIRE || '7d',
            saltRounds: 10,
            enableHSTS: false
        },
        upload: {
            maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 5242880,
            uploadPath: process.env.UPLOAD_PATH || 'uploads/'
        }
    },

    production: {
        app: {
            port: process.env.PORT || 3002,
            env: 'production',
            logLevel: 'info'
        },
        database: {
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            port: process.env.DB_PORT || 3306,
            connectionLimit: 20,
            debug: false,
            enableKeepAlive: true,
            keepAliveInitialDelayMs: 0
        },
        security: {
            corsOrigin: process.env.ALLOWED_ORIGINS ? 
                process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : 
                ['https://yourdomain.com'],
            sessionSecret: process.env.JWT_SECRET,
            jwtExpire: process.env.JWT_EXPIRE || '7d',
            saltRounds: 12,
            enableHSTS: true
        },
        upload: {
            maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 5242880,
            uploadPath: process.env.UPLOAD_PATH || 'uploads/'
        }
    },

    test: {
        app: {
            port: 3003,
            env: 'test',
            logLevel: 'error'
        },
        database: {
            host: 'localhost',
            user: 'root',
            password: '',
            database: 'servenow_test',
            port: 3306,
            connectionLimit: 5,
            debug: false
        },
        security: {
            corsOrigin: true,
            sessionSecret: 'test-secret-key',
            jwtExpire: '1h',
            saltRounds: 10,
            enableHSTS: false
        },
        upload: {
            maxFileSize: 5242880,
            uploadPath: 'uploads/'
        }
    }
};

const getConfig = () => {
    if (isProduction) return config.production;
    if (isTest) return config.test;
    return config.development;
};

const validateRequiredEnv = () => {
    const required = ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET'];
    
    if (isProduction) {
        required.push('DB_PASSWORD', 'ALLOWED_ORIGINS');
    }

    for (const env of required) {
        if (!process.env[env] && isProduction) {
            throw new Error(`Missing required environment variable: ${env}`);
        }
    }
};

module.exports = {
    isDevelopment,
    isProduction,
    isTest,
    getConfig,
    validateRequiredEnv,
    config
};
