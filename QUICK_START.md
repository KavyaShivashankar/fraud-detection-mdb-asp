# Quick Start Guide

Get the fraud detection system up and running in 5 minutes!

## Prerequisites

- Node.js 18+ installed
- MongoDB Atlas account (free tier works for testing)

## Step 1: Install Dependencies (30 seconds)

```bash
npm install
```

## Step 2: Configure MongoDB Atlas (2 minutes)

1. Create a free MongoDB Atlas cluster at https://cloud.mongodb.com
2. Get your connection string
3. Create `.env` file:

```bash
cp .env.example .env
```

4. Edit `.env` and add your connection string:

```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
```

## Step 3: Generate Sample Data (1 minute)

```bash
npm run generate-data
```

This creates:
- ✅ 50 user profiles
- ✅ 1,000 transactions
- ✅ Database indexes

## Step 4: Deploy Stream Processor (2 minutes)

### Using Atlas UI:

1. Go to your Atlas cluster → **Stream Processing**
2. Click **Create Stream Processor**
3. Name: `fraud-detection-processor`
4. Copy pipeline from `stream-processing/fraud-detection-pipeline.json`
5. Set:
   - Source: `fraud_detection.transactions`
   - Sink: `fraud_detection.processed_transactions`
6. Click **Start Processor**

## Step 5: Run the Application (30 seconds)

```bash
npm start
```

You should see:
```
✓ Connected to MongoDB Atlas

📊 Fraud Detection Dashboard
═══════════════════════════════════════

Transactions:
  Total: 1000
  Fraudulent: 50
  Avg Fraud Score: 12.45

🔍 Monitoring processed transactions for fraud...
```

## Test Fraud Detection

Open MongoDB Compass or Atlas UI and insert a fraudulent transaction:

```javascript
db.transactions.insertOne({
  transaction_id: "txn_test_fraud",
  timestamp: new Date(),
  user_id: "user_00001",
  account_id: "acc_12345",
  amount: 5000,  // Very high amount
  currency: "USD",
  transaction_type: "purchase",
  merchant: {
    merchant_id: "merch_999",
    merchant_name: "Unknown Merchant",
    merchant_category: "5999",
    merchant_country: "NG"  // High-risk country
  },
  location: {
    ip_address: "41.58.0.1",
    country: "NG",
    city: "Lagos",
    coordinates: { type: "Point", coordinates: [3.3792, 6.5244] }
  },
  device: {
    device_id: "dev_unknown",
    device_type: "mobile",
    os: "Android 14",
    browser: "Chrome"
  },
  payment_method: {
    type: "credit_card",
    last_four: "9999",
    card_brand: "visa"
  },
  status: "pending"
})
```

Watch your terminal for:
```
🚨 Fraud detected: txn_test_fraud
   Score: 85
   Indicators: high_amount, unusual_location, new_device
   ✓ Alert created: alert_1234567890_123
```

## What's Happening?

1. **Transaction inserted** → `transactions` collection
2. **Stream processor** → Analyzes in real-time
3. **Fraud score calculated** → Based on multiple indicators
4. **Result written** → `processed_transactions` collection
5. **Alert created** → If fraud score ≥ 70
6. **Notification sent** → Email/SMS/Webhook (if configured)

## Project Structure

```
fraud_detection_example/
├── models/              # Data models (Transaction, User, Alert)
├── src/                 # Application code
│   ├── index.js        # Main app with monitoring
│   └── fraud-detector.js  # Fraud detection engine
├── scripts/            # Utilities
│   └── generate-sample-data.js
├── stream-processing/  # Atlas Stream Processing pipelines
├── config/             # Configuration files
└── docs/               # Documentation
```

## Key Files

- **README.md** - Full documentation
- **SETUP_GUIDE.md** - Detailed setup instructions
- **ARCHITECTURE.md** - System architecture details
- **QUERIES.md** - Useful MongoDB queries

## Fraud Detection Rules

| Indicator | Score | Trigger |
|-----------|-------|---------|
| High Amount | +25 | 3x average transaction |
| Unusual Location | +30 | New country |
| New Device | +20 | Unknown device |
| High Velocity | +30 | 10+ transactions/hour |
| Unusual Time | +15 | 2-5 AM transactions |

**Fraud Score Thresholds:**
- 0-29: ✅ Allow
- 30-49: ⚠️ Monitor
- 50-69: 🔍 Review
- 70-84: 🚨 Verify
- 85-100: 🛑 Block

## Next Steps

1. **Customize Rules** - Edit `config/atlas-config.js`
2. **Add Notifications** - Configure email/SMS in `.env`
3. **Create Dashboards** - Use MongoDB Charts
4. **Deploy to Production** - See SETUP_GUIDE.md

## Troubleshooting

**Can't connect to Atlas?**
- Check connection string in `.env`
- Verify IP whitelist in Atlas Network Access

**Stream processor not working?**
- Ensure cluster is M10+ (required for Stream Processing)
- Check processor status in Atlas UI
- Verify pipeline syntax

**No fraud alerts?**
- Check that stream processor is running
- Verify transactions have `status: "pending"`
- Ensure fraud score ≥ 70

## Support

- 📖 [Full Documentation](README.md)
- 🏗️ [Architecture Guide](ARCHITECTURE.md)
- 🔧 [Setup Guide](SETUP_GUIDE.md)
- 💬 [MongoDB Community Forums](https://www.mongodb.com/community/forums/)

## License

MIT

