// ===== FRAUDULENT TRANSACTIONS (6) =====
// Pattern: overseas location + amount >3x avg + unknown 5-digit device → score 75

db.transactions.insertOne({
  transaction_id: "txn_test_00001",
  timestamp: new Date(),
  user_id: "user_00002",
  account_id: "acc_43821",
  amount: 1500,
  currency: "USD",
  transaction_type: "purchase",
  merchant: { merchant_id: "merch_003", merchant_name: "Electronics Store", merchant_category: "5732", merchant_country: "US" },
  location: { ip_address: "41.58.12.9", country: "NG", city: "Lagos", coordinates: { type: "Point", coordinates: [3.3792, 6.5244] } },
  device: { device_id: "dev_54321", device_type: "mobile", os: "Android 14", browser: "Chrome" },
  payment_method: { type: "credit_card", last_four: "8821", card_brand: "visa" },
  status: "pending"
})

db.transactions.insertOne({
  transaction_id: "txn_test_00002",
  timestamp: new Date(),
  user_id: "user_00003",
  account_id: "acc_71045",
  amount: 2100,
  currency: "USD",
  transaction_type: "purchase",
  merchant: { merchant_id: "merch_009", merchant_name: "Hotel", merchant_category: "7011", merchant_country: "US" },
  location: { ip_address: "103.45.67.89", country: "JP", city: "Tokyo", coordinates: { type: "Point", coordinates: [139.6917, 35.6895] } },
  device: { device_id: "dev_67890", device_type: "desktop", os: "Windows 11", browser: "Edge" },
  payment_method: { type: "credit_card", last_four: "3344", card_brand: "mastercard" },
  status: "pending"
})

db.transactions.insertOne({
  transaction_id: "txn_test_00003",
  timestamp: new Date(),
  user_id: "user_00004",
  account_id: "acc_29367",
  amount: 1750,
  currency: "USD",
  transaction_type: "withdrawal",
  merchant: { merchant_id: "merch_010", merchant_name: "Airline", merchant_category: "4511", merchant_country: "US" },
  location: { ip_address: "77.152.34.1", country: "FR", city: "Paris", coordinates: { type: "Point", coordinates: [2.3522, 48.8566] } },
  device: { device_id: "dev_23456", device_type: "tablet", os: "iOS 17", browser: "Safari" },
  payment_method: { type: "credit_card", last_four: "5521", card_brand: "amex" },
  status: "pending"
})

db.transactions.insertOne({
  transaction_id: "txn_test_00004",
  timestamp: new Date(),
  user_id: "user_00005",
  account_id: "acc_58204",
  amount: 1200,
  currency: "USD",
  transaction_type: "transfer",
  merchant: { merchant_id: "merch_006", merchant_name: "Online Retailer", merchant_category: "5999", merchant_country: "US" },
  location: { ip_address: "86.10.55.23", country: "GB", city: "London", coordinates: { type: "Point", coordinates: [-0.1276, 51.5074] } },
  device: { device_id: "dev_87654", device_type: "mobile", os: "Android 14", browser: "Firefox" },
  payment_method: { type: "credit_card", last_four: "7799", card_brand: "visa" },
  status: "pending"
})

db.transactions.insertOne({
  transaction_id: "txn_test_00005",
  timestamp: new Date(),
  user_id: "user_00007",
  account_id: "acc_33987",
  amount: 950,
  currency: "USD",
  transaction_type: "purchase",
  merchant: { merchant_id: "merch_008", merchant_name: "Clothing Store", merchant_category: "5651", merchant_country: "US" },
  location: { ip_address: "41.203.77.4", country: "NG", city: "Lagos", coordinates: { type: "Point", coordinates: [3.3792, 6.5244] } },
  device: { device_id: "dev_34512", device_type: "mobile", os: "iOS 17", browser: "Chrome" },
  payment_method: { type: "credit_card", last_four: "1122", card_brand: "discover" },
  status: "pending"
})

db.transactions.insertOne({
  transaction_id: "txn_test_00006",
  timestamp: new Date(),
  user_id: "user_00009",
  account_id: "acc_64512",
  amount: 3200,
  currency: "USD",
  transaction_type: "purchase",
  merchant: { merchant_id: "merch_003", merchant_name: "Electronics Store", merchant_category: "5732", merchant_country: "US" },
  location: { ip_address: "118.27.81.45", country: "JP", city: "Tokyo", coordinates: { type: "Point", coordinates: [139.6917, 35.6895] } },
  device: { device_id: "dev_76543", device_type: "desktop", os: "macOS 14", browser: "Safari" },
  payment_method: { type: "credit_card", last_four: "9988", card_brand: "mastercard" },
  status: "pending"
})


// ===== LEGITIMATE TRANSACTIONS (4) =====
// Using user_00001 (known profile: avg $174, US/Chicago, dev_3754) → score 0

db.transactions.insertOne({
  transaction_id: "txn_test_00007",
  timestamp: new Date(),
  user_id: "user_00001",
  account_id: "acc_60945",
  amount: 85,
  currency: "USD",
  transaction_type: "purchase",
  merchant: { merchant_id: "merch_001", merchant_name: "Coffee Shop", merchant_category: "5814", merchant_country: "US" },
  location: { ip_address: "192.168.1.45", country: "US", city: "Chicago", coordinates: { type: "Point", coordinates: [-87.6298, 41.8781] } },
  device: { device_id: "dev_3754", device_type: "mobile", os: "iOS 17", browser: "Safari" },
  payment_method: { type: "credit_card", last_four: "4242", card_brand: "visa" },
  status: "pending"
})

db.transactions.insertOne({
  transaction_id: "txn_test_00008",
  timestamp: new Date(),
  user_id: "user_00001",
  account_id: "acc_60945",
  amount: 120,
  currency: "USD",
  transaction_type: "purchase",
  merchant: { merchant_id: "merch_002", merchant_name: "Grocery Store", merchant_category: "5411", merchant_country: "US" },
  location: { ip_address: "192.168.1.45", country: "US", city: "Chicago", coordinates: { type: "Point", coordinates: [-87.6298, 41.8781] } },
  device: { device_id: "dev_3754", device_type: "mobile", os: "iOS 17", browser: "Safari" },
  payment_method: { type: "credit_card", last_four: "4242", card_brand: "visa" },
  status: "pending"
})

db.transactions.insertOne({
  transaction_id: "txn_test_00009",
  timestamp: new Date(),
  user_id: "user_00001",
  account_id: "acc_60945",
  amount: 200,
  currency: "USD",
  transaction_type: "purchase",
  merchant: { merchant_id: "merch_005", merchant_name: "Restaurant", merchant_category: "5812", merchant_country: "US" },
  location: { ip_address: "10.0.0.112", country: "US", city: "Chicago", coordinates: { type: "Point", coordinates: [-87.6298, 41.8781] } },
  device: { device_id: "dev_3754", device_type: "mobile", os: "iOS 17", browser: "Safari" },
  payment_method: { type: "credit_card", last_four: "4242", card_brand: "visa" },
  status: "pending"
})

db.transactions.insertOne({
  transaction_id: "txn_test_00010",
  timestamp: new Date(),
  user_id: "user_00001",
  account_id: "acc_60945",
  amount: 55,
  currency: "USD",
  transaction_type: "purchase",
  merchant: { merchant_id: "merch_007", merchant_name: "Pharmacy", merchant_category: "5912", merchant_country: "US" },
  location: { ip_address: "10.0.0.112", country: "US", city: "Chicago", coordinates: { type: "Point", coordinates: [-87.6298, 41.8781] } },
  device: { device_id: "dev_3754", device_type: "mobile", os: "iOS 17", browser: "Safari" },
  payment_method: { type: "credit_card", last_four: "4242", card_brand: "visa" },
  status: "pending"
})
