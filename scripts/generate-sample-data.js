/**
 * Sample Data Generator for Fraud Detection System
 * 
 * Generates realistic transaction and user profile data for testing
 */

const { MongoClient } = require('mongodb');
const config = require('../config/atlas-config');

// Sample data pools
const MERCHANTS = [
  { id: 'merch_001', name: 'Coffee Shop', category: '5814', country: 'US' },
  { id: 'merch_002', name: 'Grocery Store', category: '5411', country: 'US' },
  { id: 'merch_003', name: 'Electronics Store', category: '5732', country: 'US' },
  { id: 'merch_004', name: 'Gas Station', category: '5541', country: 'US' },
  { id: 'merch_005', name: 'Restaurant', category: '5812', country: 'US' },
  { id: 'merch_006', name: 'Online Retailer', category: '5999', country: 'US' },
  { id: 'merch_007', name: 'Pharmacy', category: '5912', country: 'US' },
  { id: 'merch_008', name: 'Clothing Store', category: '5651', country: 'US' },
  { id: 'merch_009', name: 'Hotel', category: '7011', country: 'US' },
  { id: 'merch_010', name: 'Airline', category: '4511', country: 'US' }
];

const CITIES = [
  { name: 'New York', country: 'US', coords: [-74.0060, 40.7128] },
  { name: 'Los Angeles', country: 'US', coords: [-118.2437, 34.0522] },
  { name: 'Chicago', country: 'US', coords: [-87.6298, 41.8781] },
  { name: 'Houston', country: 'US', coords: [-95.3698, 29.7604] },
  { name: 'London', country: 'GB', coords: [-0.1276, 51.5074] },
  { name: 'Paris', country: 'FR', coords: [2.3522, 48.8566] },
  { name: 'Tokyo', country: 'JP', coords: [139.6917, 35.6895] },
  { name: 'Lagos', country: 'NG', coords: [3.3792, 6.5244] }
];

const TRANSACTION_TYPES = ['purchase', 'withdrawal', 'transfer', 'deposit'];
const CARD_BRANDS = ['visa', 'mastercard', 'amex', 'discover'];
const DEVICE_TYPES = ['mobile', 'desktop', 'tablet'];
const OS_TYPES = ['iOS 17', 'Android 14', 'Windows 11', 'macOS 14'];

/**
 * Generate a random number between min and max
 */
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate a random element from an array
 */
function randomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Generate a user profile
 */
function generateUserProfile(userId) {
  const accountId = `acc_${randomBetween(10000, 99999)}`;
  const createdDate = new Date(Date.now() - randomBetween(30, 730) * 24 * 60 * 60 * 1000);
  
  return {
    user_id: userId,
    account_id: accountId,
    email: `user${userId.split('_')[1]}@example.com`,
    phone: `+1${randomBetween(1000000000, 9999999999)}`,
    created_at: createdDate,
    account_status: 'active',
    kyc_verified: Math.random() > 0.1,
    patterns: {
      avg_transaction_amount: userId === "user_00001" ? randomBetween(100, 300) : randomBetween(50, 300),
      avg_daily_transactions: randomBetween(1, 5),
      common_transaction_hours: [9, 12, 14, 18, 20],
      frequent_locations: [
        { country: 'US', city: randomElement(CITIES.filter(c => c.country === 'US')).name, count: randomBetween(100, 500) }
      ],
      known_devices: userId === "user_00001" ? ["dev_abc123"] : [`dev_${randomBetween(1000, 9999)}`],
      frequent_merchants: MERCHANTS.slice(0, 3).map(m => ({
        merchant_id: m.id,
        merchant_name: m.name,
        count: randomBetween(10, 100)
      })),
      transaction_type_distribution: {
        purchase: 0.85,
        withdrawal: 0.10,
        transfer: 0.04,
        deposit: 0.01
      }
    },
    risk_profile: {
      risk_level: 'low',
      risk_score: randomBetween(0, 30),
      last_updated: new Date(),
      fraud_history: []
    },
    limits: {
      daily_transaction_limit: 5000,
      single_transaction_limit: 2000,
      monthly_limit: 50000
    }
  };
}

/**
 * Generate a transaction
 */
function generateTransaction(userId, accountId, fraudType = null, knownDevices = []) {
  const transactionId = `txn_${Date.now()}_${randomBetween(1000, 9999)}`;
  const merchant = randomElement(MERCHANTS);

  const signals = fraudType ? fraudType.split('+') : [];

  const city = signals.includes('unusual_location')
    ? randomElement(CITIES.filter(c => c.country !== 'US'))
    : randomElement(CITIES.filter(c => c.country === 'US'));

  const baseAmount = randomBetween(10, 300);
  const amount = signals.includes('high_amount')
    ? randomBetween(1000, 5000)
    : baseAmount;

  // Use a known device if available and new_device signal not requested
  let deviceId;
  if (signals.includes('new_device') || !knownDevices.length) {
    deviceId = `dev_${randomBetween(10000, 99999)}`;
  } else {
    deviceId = knownDevices[Math.floor(Math.random() * knownDevices.length)];
  }

  return {
    transaction_id: transactionId,
    timestamp: new Date(),
    user_id: userId,
    account_id: accountId,
    amount: amount,
    currency: 'USD',
    transaction_type: randomElement(TRANSACTION_TYPES),
    merchant: {
      merchant_id: merchant.id,
      merchant_name: merchant.name,
      merchant_category: merchant.category,
      merchant_country: merchant.country
    },
    location: {
      ip_address: `${randomBetween(1, 255)}.${randomBetween(1, 255)}.${randomBetween(1, 255)}.${randomBetween(1, 255)}`,
      country: city.country,
      city: city.name,
      coordinates: {
        type: 'Point',
        coordinates: city.coords
      }
    },
    device: {
      device_id: deviceId,
      device_type: randomElement(DEVICE_TYPES),
      os: randomElement(OS_TYPES),
      browser: randomElement(['Chrome', 'Safari', 'Firefox', 'Edge'])
    },
    payment_method: {
      type: 'credit_card',
      last_four: String(randomBetween(1000, 9999)),
      card_brand: randomElement(CARD_BRANDS)
    },
    status: 'pending',
    fraud_score: 0,
    fraud_indicators: [],
    is_fraudulent: false,
    metadata: {}
  };
}
/**
 * Main function to generate and insert sample data
 */
async function generateSampleData() {
  const uri = config.atlas.connectionString;
  const client = new MongoClient(uri, config.atlas.options);

  try {
    await client.connect();
    console.log('Connected to MongoDB Atlas');

    const db = client.db(config.atlas.database);
    const usersCollection = db.collection(config.atlas.collections.users);
    const transactionsCollection = db.collection(config.atlas.collections.transactions);

    // Clear existing data (optional)
    console.log('\nClearing existing data...');
    await usersCollection.deleteMany({});
    await transactionsCollection.deleteMany({});

    // Generate users
    console.log('\nGenerating user profiles...');
    const users = [];
    const numUsers = 50;

    for (let i = 1; i <= numUsers; i++) {
      const userId = `user_${String(i).padStart(5, '0')}`;
      users.push(generateUserProfile(userId));
    }

    await usersCollection.insertMany(users);
    console.log(`✓ Created ${numUsers} user profiles`);

    // Generate transactions with varied fraud patterns
    const transactions = [];
    const numTransactionsPerUser = 20;
    const fraudPercentage = 0.05; // 5% fraudulent transactions

    // Fraud pattern types — each triggers different indicators
    const fraudPatterns = [
      'high_amount',                                    // only high_amount
      'unusual_location',                               // only unusual_location
      'new_device',                                     // only new_device
      'high_amount+unusual_location',                   // two signals
      'high_amount+new_device',                         // two signals
      'unusual_location+new_device',                    // two signals
      'high_amount+unusual_location+new_device',        // all three
    ];

    let fraudCount = 0;
    let cleanCount = 0;

    for (const user of users) {
      for (let i = 0; i < numTransactionsPerUser; i++) {
        if (Math.random() < fraudPercentage) {
          // Pick a random fraud pattern
          const pattern = fraudPatterns[Math.floor(Math.random() * fraudPatterns.length)];
          transactions.push(generateTransaction(user.user_id, user.account_id, pattern, user.patterns.known_devices));
          fraudCount++;
        } else {
          transactions.push(generateTransaction(user.user_id, user.account_id, null, user.patterns.known_devices));
          cleanCount++;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    await transactionsCollection.insertMany(transactions);
    console.log(`✓ Created ${transactions.length} transactions`);
    console.log(`  - Legitimate: ${cleanCount}`);
    console.log(`  - Potentially fraudulent: ${fraudCount} (varied patterns: single, double, and triple indicator)`);
    // Create indexes
    console.log('\nCreating indexes...');

    await transactionsCollection.createIndex({ user_id: 1, timestamp: -1 });
    await transactionsCollection.createIndex({ status: 1 });
    await transactionsCollection.createIndex({ timestamp: -1 });
    await transactionsCollection.createIndex({ 'location.coordinates': '2dsphere' });

    await usersCollection.createIndex({ user_id: 1 }, { unique: true });
    await usersCollection.createIndex({ email: 1 }, { unique: true });

    console.log('✓ Indexes created');

    console.log('\n✅ Sample data generation complete!');
    console.log('\nNext steps:');
    console.log('1. Deploy the Stream Processing pipeline');
    console.log('2. Monitor transactions in real-time');
    console.log('3. Review fraud alerts');

  } catch (error) {
    console.error('Error generating sample data:', error);
    throw error;
  } finally {
    await client.close();
  }
}

// Run if executed directly
if (require.main === module) {
  generateSampleData()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { generateUserProfile, generateTransaction, generateSampleData };

