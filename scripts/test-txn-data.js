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

// ===== ADDITIONAL FRAUDULENT TRANSACTIONS (10) =====
// Each uses a distinct fraud pattern and country

db.transactions.insertMany([
  {
    // Impossible travel: user transacted in Chicago 2 hours ago, now in Brazil
    transaction_id: "txn_test_00020",
    timestamp: new Date(),
    user_id: "user_00002",
    account_id: "acc_43821",
    amount: 2800,
    currency: "USD",
    transaction_type: "purchase",
    merchant: { merchant_id: "merch_021", merchant_name: "Luxury Boutique", merchant_category: "5699", merchant_country: "BR" },
    location: { ip_address: "177.92.14.33", country: "BR", city: "São Paulo", coordinates: { type: "Point", coordinates: [-46.6333, -23.5505] } },
    device: { device_id: "dev_99001", device_type: "mobile", os: "Android 14", browser: "Chrome" },
    payment_method: { type: "credit_card", last_four: "8821", card_brand: "visa" },
    fraud_indicators: ["impossible_travel", "unusual_location"],
    fraud_score: 0.91,
    status: "pending"
  },
  {
    // Card testing: small probe transaction before large fraud
    transaction_id: "txn_test_00021",
    timestamp: new Date(),
    user_id: "user_00011",
    account_id: "acc_55231",
    amount: 1,
    currency: "USD",
    transaction_type: "purchase",
    merchant: { merchant_id: "merch_022", merchant_name: "Digital Goods Shop", merchant_category: "5045", merchant_country: "RU" },
    location: { ip_address: "95.173.128.44", country: "RU", city: "Moscow", coordinates: { type: "Point", coordinates: [37.6173, 55.7558] } },
    device: { device_id: "dev_99002", device_type: "desktop", os: "Windows 10", browser: "Chrome" },
    payment_method: { type: "credit_card", last_four: "4491", card_brand: "mastercard" },
    fraud_indicators: ["card_testing", "high_risk_country"],
    fraud_score: 0.88,
    status: "pending"
  },
  {
    // Account takeover: new unknown device, password reset 10 min prior, high-value transfer
    transaction_id: "txn_test_00022",
    timestamp: new Date(),
    user_id: "user_00013",
    account_id: "acc_77841",
    amount: 4500,
    currency: "USD",
    transaction_type: "transfer",
    merchant: { merchant_id: "merch_023", merchant_name: "Wire Transfer Service", merchant_category: "6012", merchant_country: "CN" },
    location: { ip_address: "116.228.89.71", country: "CN", city: "Shanghai", coordinates: { type: "Point", coordinates: [121.4737, 31.2304] } },
    device: { device_id: "dev_99003", device_type: "desktop", os: "Windows 11", browser: "Edge" },
    payment_method: { type: "bank_transfer", last_four: "0012", card_brand: "none" },
    fraud_indicators: ["account_takeover", "new_device", "unusual_location"],
    fraud_score: 0.97,
    status: "pending"
  },
  {
    // Velocity abuse: 12 transactions in 30 minutes on same card
    transaction_id: "txn_test_00023",
    timestamp: new Date(),
    user_id: "user_00015",
    account_id: "acc_38120",
    amount: 640,
    currency: "EUR",
    transaction_type: "purchase",
    merchant: { merchant_id: "merch_024", merchant_name: "Online Casino", merchant_category: "7995", merchant_country: "RO" },
    location: { ip_address: "89.137.204.11", country: "RO", city: "Bucharest", coordinates: { type: "Point", coordinates: [26.1025, 44.4268] } },
    device: { device_id: "dev_99004", device_type: "desktop", os: "Windows 10", browser: "Firefox" },
    payment_method: { type: "credit_card", last_four: "3317", card_brand: "visa" },
    fraud_indicators: ["velocity_abuse", "high_risk_merchant", "unusual_location"],
    fraud_score: 0.93,
    status: "pending"
  },
  {
    // Proxy/VPN detected + card not present + mismatched billing country
    transaction_id: "txn_test_00024",
    timestamp: new Date(),
    user_id: "user_00017",
    account_id: "acc_91045",
    amount: 1890,
    currency: "USD",
    transaction_type: "purchase",
    merchant: { merchant_id: "merch_025", merchant_name: "Crypto Exchange", merchant_category: "6099", merchant_country: "UA" },
    location: { ip_address: "185.220.101.52", country: "UA", city: "Kyiv", coordinates: { type: "Point", coordinates: [30.5238, 50.4501] } },
    device: { device_id: "dev_99005", device_type: "mobile", os: "iOS 16", browser: "Safari" },
    payment_method: { type: "credit_card", last_four: "6643", card_brand: "amex" },
    fraud_indicators: ["proxy_detected", "card_not_present", "billing_mismatch"],
    fraud_score: 0.89,
    status: "pending"
  },
  {
    // Stolen card pattern: purchases across multiple merchant categories in under 1 hour
    transaction_id: "txn_test_00025",
    timestamp: new Date(),
    user_id: "user_00019",
    account_id: "acc_20813",
    amount: 3100,
    currency: "INR",
    transaction_type: "purchase",
    merchant: { merchant_id: "merch_026", merchant_name: "Jewelry Store", merchant_category: "5944", merchant_country: "IN" },
    location: { ip_address: "103.21.58.14", country: "IN", city: "Mumbai", coordinates: { type: "Point", coordinates: [72.8777, 19.0760] } },
    device: { device_id: "dev_99006", device_type: "mobile", os: "Android 13", browser: "Chrome" },
    payment_method: { type: "credit_card", last_four: "2209", card_brand: "mastercard" },
    fraud_indicators: ["stolen_card_pattern", "rapid_category_spread"],
    fraud_score: 0.85,
    status: "pending"
  },
  {
    // High-value cash advance at unusual hour (3am local time)
    transaction_id: "txn_test_00026",
    timestamp: new Date(),
    user_id: "user_00021",
    account_id: "acc_47390",
    amount: 5000,
    currency: "ZAR",
    transaction_type: "withdrawal",
    merchant: { merchant_id: "merch_027", merchant_name: "ATM Withdrawal", merchant_category: "6011", merchant_country: "ZA" },
    location: { ip_address: "41.185.8.97", country: "ZA", city: "Johannesburg", coordinates: { type: "Point", coordinates: [28.0473, -26.2041] } },
    device: { device_id: "dev_99007", device_type: "atm", os: "unknown", browser: "none" },
    payment_method: { type: "debit_card", last_four: "8834", card_brand: "visa" },
    fraud_indicators: ["unusual_time", "high_value_cash_advance", "unusual_location"],
    fraud_score: 0.82,
    status: "pending"
  },
  {
    // Multiple failed auth attempts before success — brute-forced PIN
    transaction_id: "txn_test_00027",
    timestamp: new Date(),
    user_id: "user_00023",
    account_id: "acc_63402",
    amount: 2200,
    currency: "MXN",
    transaction_type: "purchase",
    merchant: { merchant_id: "merch_028", merchant_name: "Electronics Warehouse", merchant_category: "5732", merchant_country: "MX" },
    location: { ip_address: "187.141.22.78", country: "MX", city: "Mexico City", coordinates: { type: "Point", coordinates: [-99.1332, 19.4326] } },
    device: { device_id: "dev_99008", device_type: "mobile", os: "Android 12", browser: "Chrome" },
    payment_method: { type: "credit_card", last_four: "5577", card_brand: "mastercard" },
    fraud_indicators: ["multiple_failed_auth", "brute_forced_pin"],
    fraud_score: 0.87,
    status: "pending"
  },
  {
    // Rapid succession: 5th transaction in 8 minutes, amount escalating each time
    transaction_id: "txn_test_00028",
    timestamp: new Date(),
    user_id: "user_00025",
    account_id: "acc_84571",
    amount: 3750,
    currency: "AUD",
    transaction_type: "purchase",
    merchant: { merchant_id: "merch_029", merchant_name: "Gift Card Portal", merchant_category: "5999", merchant_country: "AU" },
    location: { ip_address: "203.12.160.44", country: "AU", city: "Sydney", coordinates: { type: "Point", coordinates: [151.2093, -33.8688] } },
    device: { device_id: "dev_99009", device_type: "desktop", os: "macOS 13", browser: "Safari" },
    payment_method: { type: "credit_card", last_four: "1198", card_brand: "visa" },
    fraud_indicators: ["rapid_succession", "escalating_amounts", "gift_card_abuse"],
    fraud_score: 0.90,
    status: "pending"
  },
  {
    // Geo-blocked country + blacklisted BIN range
    transaction_id: "txn_test_00029",
    timestamp: new Date(),
    user_id: "user_00027",
    account_id: "acc_12904",
    amount: 1650,
    currency: "THB",
    transaction_type: "purchase",
    merchant: { merchant_id: "merch_030", merchant_name: "Luxury Travel Agency", merchant_category: "4722", merchant_country: "TH" },
    location: { ip_address: "125.26.178.53", country: "TH", city: "Bangkok", coordinates: { type: "Point", coordinates: [100.5018, 13.7563] } },
    device: { device_id: "dev_99010", device_type: "mobile", os: "iOS 17", browser: "Chrome" },
    payment_method: { type: "credit_card", last_four: "7723", card_brand: "discover" },
    fraud_indicators: ["geo_blocked_country", "blacklisted_bin", "unusual_location"],
    fraud_score: 0.94,
    status: "pending"
  }
])

