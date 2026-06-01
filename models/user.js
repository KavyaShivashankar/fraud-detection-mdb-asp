/**
 * User Profile Data Model
 * 
 * Stores user information and historical patterns for fraud detection
 */

const UserProfileSchema = {
  // User identification
  user_id: String,
  account_id: String,
  
  // User details
  email: String,
  phone: String,
  created_at: Date,
  
  // User status
  account_status: String, // 'active', 'suspended', 'closed'
  kyc_verified: Boolean,
  
  // Historical patterns (used for anomaly detection)
  patterns: {
    // Average transaction amount
    avg_transaction_amount: Number,
    
    // Typical transaction frequency (per day)
    avg_daily_transactions: Number,
    
    // Common transaction times (hour of day)
    common_transaction_hours: [Number],
    
    // Frequently used locations
    frequent_locations: [{
      country: String,
      city: String,
      count: Number
    }],
    
    // Frequently used devices
    known_devices: [String],
    
    // Common merchants
    frequent_merchants: [{
      merchant_id: String,
      merchant_name: String,
      count: Number
    }],
    
    // Typical transaction types
    transaction_type_distribution: {
      purchase: Number,
      withdrawal: Number,
      transfer: Number,
      deposit: Number
    }
  },
  
  // Risk profile
  risk_profile: {
    risk_level: String, // 'low', 'medium', 'high'
    risk_score: Number, // 0-100
    last_updated: Date,
    
    // Historical fraud incidents
    fraud_history: [{
      incident_date: Date,
      transaction_id: String,
      fraud_type: String,
      resolved: Boolean
    }]
  },
  
  // Account limits
  limits: {
    daily_transaction_limit: Number,
    single_transaction_limit: Number,
    monthly_limit: Number
  }
};

// Sample user profile
const sampleUserProfile = {
  user_id: "user_12345",
  account_id: "acc_67890",
  email: "user@example.com",
  phone: "+1234567890",
  created_at: new Date("2023-01-15"),
  account_status: "active",
  kyc_verified: true,
  patterns: {
    avg_transaction_amount: 150.00,
    avg_daily_transactions: 2.5,
    common_transaction_hours: [9, 12, 18, 20],
    frequent_locations: [
      { country: "US", city: "New York", count: 450 },
      { country: "US", city: "Boston", count: 50 }
    ],
    known_devices: ["dev_abc123", "dev_xyz789"],
    frequent_merchants: [
      { merchant_id: "merch_001", merchant_name: "Coffee Shop", count: 200 },
      { merchant_id: "merch_002", merchant_name: "Grocery Store", count: 150 }
    ],
    transaction_type_distribution: {
      purchase: 0.85,
      withdrawal: 0.10,
      transfer: 0.04,
      deposit: 0.01
    }
  },
  risk_profile: {
    risk_level: "low",
    risk_score: 15,
    last_updated: new Date(),
    fraud_history: []
  },
  limits: {
    daily_transaction_limit: 5000,
    single_transaction_limit: 2000,
    monthly_limit: 50000
  }
};

module.exports = { UserProfileSchema, sampleUserProfile };

