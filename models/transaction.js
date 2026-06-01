/**
 * Transaction Data Model for Fraud Detection
 * 
 * This model represents a financial transaction that will be processed
 * through the MongoDB Atlas Stream Processing pipeline
 */

const TransactionSchema = {
  // Unique transaction identifier
  transaction_id: String,
  
  // Timestamp of the transaction
  timestamp: Date,
  
  // User information
  user_id: String,
  account_id: String,
  
  // Transaction details
  amount: Number,
  currency: String,
  
  // Transaction type: 'purchase', 'withdrawal', 'transfer', 'deposit'
  transaction_type: String,
  
  // Merchant information
  merchant: {
    merchant_id: String,
    merchant_name: String,
    merchant_category: String, // MCC code category
    merchant_country: String
  },
  
  // Location data
  location: {
    ip_address: String,
    country: String,
    city: String,
    coordinates: {
      type: "Point",
      coordinates: [Number, Number] // [longitude, latitude]
    }
  },
  
  // Device information
  device: {
    device_id: String,
    device_type: String, // 'mobile', 'desktop', 'tablet'
    os: String,
    browser: String
  },
  
  // Payment method
  payment_method: {
    type: String, // 'credit_card', 'debit_card', 'bank_transfer', 'digital_wallet'
    last_four: String,
    card_brand: String // 'visa', 'mastercard', 'amex', etc.
  },
  
  // Transaction status
  status: String, // 'pending', 'completed', 'failed', 'flagged'
  
  // Fraud detection fields (populated by stream processing)
  fraud_score: Number, // 0-100
  fraud_indicators: [String],
  is_fraudulent: Boolean,
  fraud_reason: String,
  
  // Additional metadata
  metadata: Object
};

// Sample transaction document
const sampleTransaction = {
  transaction_id: "txn_1234567890",
  timestamp: new Date(),
  user_id: "user_12345",
  account_id: "acc_67890",
  amount: 299.99,
  currency: "USD",
  transaction_type: "purchase",
  merchant: {
    merchant_id: "merch_001",
    merchant_name: "Electronics Store",
    merchant_category: "5732", // Electronics
    merchant_country: "US"
  },
  location: {
    ip_address: "192.168.1.1",
    country: "US",
    city: "New York",
    coordinates: {
      type: "Point",
      coordinates: [-74.0060, 40.7128]
    }
  },
  device: {
    device_id: "dev_abc123",
    device_type: "mobile",
    os: "iOS 17",
    browser: "Safari"
  },
  payment_method: {
    type: "credit_card",
    last_four: "4242",
    card_brand: "visa"
  },
  status: "pending",
  fraud_score: 0,
  fraud_indicators: [],
  is_fraudulent: false,
  metadata: {}
};

module.exports = { TransactionSchema, sampleTransaction };

