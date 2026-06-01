/**
 * MongoDB Atlas Configuration
 * 
 * Configuration for connecting to MongoDB Atlas cluster
 */

const config = {
  // MongoDB Atlas connection string
  // Replace with your actual Atlas connection string
  atlas: {
    connectionString: process.env.MONGODB_URI || 'mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority',
    
    // Database name
    database: 'fraud_detection',
    
    // Collections
    collections: {
      transactions: 'transactions',
      users: 'user_profiles',
      fraudAlerts: 'fraud_alerts',
      fraudRules: 'fraud_rules',
      // Stream processing will write to this collection
      processedTransactions: 'processed_transactions'
    },
    
    // Connection options
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    }
  },
  
  // Stream Processing configuration
  streamProcessing: {
    // Stream processor name
    processorName: 'fraud-detection-processor',
    
    // Source connection (where transactions come from)
    source: {
      connectionName: 'fraud_detection_source',
      database: 'fraud_detection',
      collection: 'transactions'
    },
    
    // Sink connection (where results are written)
    sink: {
      connectionName: 'fraud_detection_sink',
      database: 'fraud_detection',
      collection: 'processed_transactions'
    },
    
    // Processing options
    options: {
      // Process documents in batches
      batchSize: 100,
      
      // Time window for aggregations (in seconds)
      timeWindow: 300, // 5 minutes
      
      // Dead letter queue for failed processing
      dlq: {
        enabled: true,
        collection: 'processing_errors'
      }
    }
  },
  
  // Fraud detection thresholds
  fraudDetection: {
    // Score thresholds
    thresholds: {
      low: 30,
      medium: 50,
      high: 70,
      critical: 85
    },
    
    // Velocity check settings
    velocity: {
      // Maximum transactions in time window
      maxTransactionsPerHour: 10,
      maxTransactionsPerDay: 50,
      
      // Maximum amount in time window
      maxAmountPerHour: 5000,
      maxAmountPerDay: 20000
    },
    
    // Amount deviation multiplier
    amountDeviationMultiplier: 3, // Flag if transaction is 3x average
    
    // Geographic settings
    geographic: {
      // Flag transactions from high-risk countries
      highRiskCountries: ['NG', 'GH', 'PK', 'BD'],
      
      // Maximum distance between consecutive transactions (km)
      maxDistanceBetweenTransactions: 500,
      
      // Minimum time between distant transactions (minutes)
      minTimeBetweenDistantTransactions: 60
    },
    
    // Device fingerprinting
    device: {
      // Flag if new device is used
      flagNewDevice: true,
      
      // Maximum number of devices per user
      maxDevicesPerUser: 5
    }
  },
  
  // Notification settings
  notifications: {
    email: {
      enabled: true,
      from: 'alerts@frauddetection.com',
      // Email service configuration (e.g., SendGrid, AWS SES)
      service: process.env.EMAIL_SERVICE || 'sendgrid',
      apiKey: process.env.EMAIL_API_KEY
    },
    
    sms: {
      enabled: true,
      // SMS service configuration (e.g., Twilio)
      service: process.env.SMS_SERVICE || 'twilio',
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      fromNumber: process.env.TWILIO_FROM_NUMBER
    },
    
    webhook: {
      enabled: true,
      // Webhook endpoints for fraud alerts
      endpoints: [
        process.env.WEBHOOK_URL || 'https://your-webhook-endpoint.com/fraud-alert'
      ]
    }
  }
};

module.exports = config;

