# Setup Guide - Fraud Detection System

This guide will walk you through setting up the fraud detection system from scratch.

## Prerequisites

### Required Software

- **Node.js**: Version 18 or higher
  ```bash
  node --version  # Should be v18.0.0 or higher
  ```

- **npm**: Comes with Node.js
  ```bash
  npm --version
  ```

- **Git**: For cloning the repository
  ```bash
  git --version
  ```

### MongoDB Atlas Account

1. Sign up for a free MongoDB Atlas account at https://www.mongodb.com/cloud/atlas/register
2. Create a new project (e.g., "Fraud Detection")
3. Note your Project ID (found in Project Settings)

## Step 1: Create MongoDB Atlas Cluster

### Create a Cluster

1. In Atlas, click "Build a Database"
2. Choose your tier:
   - **M0 (Free)**: Good for testing
   - **M10+**: Required for Stream Processing in production
3. Select your cloud provider and region
4. Name your cluster (e.g., "FraudDetection")
5. Click "Create Cluster"

### Enable Stream Processing

**Note**: Stream Processing requires M10+ clusters

1. Navigate to your cluster
2. Click "Stream Processing" in the left sidebar
3. If not enabled, click "Enable Stream Processing"
4. Wait for the feature to be activated

### Configure Network Access

1. Go to "Network Access" in the left sidebar
2. Click "Add IP Address"
3. For testing, you can click "Allow Access from Anywhere" (0.0.0.0/0)
   - **Production**: Add only your application's IP addresses
4. Click "Confirm"

### Create Database User

1. Go to "Database Access" in the left sidebar
2. Click "Add New Database User"
3. Choose authentication method: "Password"
4. Set username and password (save these!)
5. Set user privileges: "Atlas admin" (or custom role)
6. Click "Add User"

### Get Connection String

1. Click "Connect" on your cluster
2. Choose "Connect your application"
3. Select "Node.js" and version "4.1 or later"
4. Copy the connection string
5. Replace `<password>` with your database user password

## Step 2: Install the Application

### Clone Repository

```bash
git clone <repository-url>
cd fraud_detection_example
```

### Install Dependencies

```bash
npm install
```

This installs:
- `mongodb`: MongoDB Node.js driver
- `dotenv`: Environment variable management

### Configure Environment

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your connection string:
   ```bash
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
   ```

3. (Optional) Configure notification services:
   ```bash
   EMAIL_SERVICE=sendgrid
   EMAIL_API_KEY=your_api_key
   
   SMS_SERVICE=twilio
   TWILIO_ACCOUNT_SID=your_sid
   TWILIO_AUTH_TOKEN=your_token
   TWILIO_FROM_NUMBER=+1234567890
   ```

## Step 3: Generate Sample Data

Run the data generator to create sample users and transactions:

```bash
npm run generate-data
```

This will:
- Create 50 user profiles with realistic patterns
- Generate 1,000 transactions (5% potentially fraudulent)
- Create necessary indexes
- Display progress and summary

**Expected Output:**
```
Connected to MongoDB Atlas

Clearing existing data...

Generating user profiles...
✓ Created 50 user profiles

Generating transactions...
✓ Created 1000 transactions
  - Legitimate: 950
  - Potentially fraudulent: 50

Creating indexes...
✓ Indexes created

✅ Sample data generation complete!
```

## Step 4: Deploy Stream Processing Pipeline

### Option A: Using Atlas UI (Recommended)

1. **Open Atlas UI**:
   - Navigate to your cluster
   - Click "Stream Processing" in the sidebar

2. **Create Stream Processor**:
   - Click "Create Stream Processor"
   - Name: `fraud-detection-processor`

3. **Configure Pipeline**:
   - Copy the contents of `stream-processing/fraud-detection-pipeline.json`
   - Paste into the pipeline editor
   - Or use the visual editor to build the pipeline

4. **Set Source and Sink**:
   - **Source Connection**: Select your cluster
   - **Source Database**: `fraud_detection`
   - **Source Collection**: `transactions`
   - **Sink Connection**: Select your cluster
   - **Sink Database**: `fraud_detection`
   - **Sink Collection**: `processed_transactions`

5. **Configure Options**:
   - Enable Dead Letter Queue
   - DLQ Database: `fraud_detection`
   - DLQ Collection: `processing_errors`

6. **Validate and Deploy**:
   - Click "Validate" to check the pipeline
   - Fix any errors
   - Click "Start Processor"

### Option B: Using Atlas CLI

1. **Install Atlas CLI**:
   ```bash
   # macOS
   brew install mongodb-atlas-cli
   
   # Linux/Windows - see https://www.mongodb.com/docs/atlas/cli/stable/install-atlas-cli/
   ```

2. **Authenticate**:
   ```bash
   atlas auth login
   ```

3. **Set Project**:
   ```bash
   export ATLAS_PROJECT_ID=your-project-id
   ```

4. **Deploy** (follow instructions in deployment script):
   ```bash
   cd stream-processing
   chmod +x deploy-stream-processor.sh
   ./deploy-stream-processor.sh
   ```

## Step 5: Verify Stream Processor

### Check Processor Status

1. In Atlas UI, go to "Stream Processing"
2. Find `fraud-detection-processor`
3. Status should be "Running"
4. Check metrics:
   - Documents processed
   - Processing rate
   - Errors (should be 0)

### Test Processing

1. **Insert a test transaction**:
   ```javascript
   // In MongoDB Compass or Atlas UI
   use fraud_detection
   
   db.transactions.insertOne({
     transaction_id: "txn_test_001",
     timestamp: new Date(),
     user_id: "user_00001",
     account_id: "acc_12345",
     amount: 150,
     currency: "USD",
     transaction_type: "purchase",
     merchant: {
       merchant_id: "merch_001",
       merchant_name: "Coffee Shop",
       merchant_category: "5814",
       merchant_country: "US"
     },
     location: {
       ip_address: "192.168.1.1",
       country: "US",
       city: "New York",
       coordinates: { type: "Point", coordinates: [-74.0060, 40.7128] }
     },
     device: {
       device_id: "dev_1234",
       device_type: "mobile",
       os: "iOS 17",
       browser: "Safari"
     },
     payment_method: {
       type: "credit_card",
       last_four: "4242",
       card_brand: "visa"
     },
     status: "pending"
   })
   ```

2. **Check processed transaction**:
   ```javascript
   db.processed_transactions.findOne({ transaction_id: "txn_test_001" })
   ```

3. **Verify fraud score was calculated**:
   - Should have `fraud_score` field
   - Should have `fraud_indicators` array
   - Should have `is_fraudulent` boolean

## Step 6: Run the Application

Start the fraud detection monitoring application:

```bash
npm start
```

**Expected Output:**
```
✓ Connected to MongoDB Atlas

📊 Fraud Detection Dashboard
═══════════════════════════════════════

Transactions:
  Total: 1000
  Fraudulent: 50
  Avg Fraud Score: 12.45

Alerts:
  Total: 50
  By Severity:
    high: 30
    medium: 15
    low: 5

═══════════════════════════════════════

🔍 Monitoring processed transactions for fraud...
```

## Step 7: Test Fraud Detection

Insert a fraudulent transaction to test the system:

```javascript
db.transactions.insertOne({
  transaction_id: "txn_fraud_test",
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
    device_id: "dev_unknown_999",  // New device
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

You should see:
```
🚨 Fraud detected: txn_fraud_test
   Score: 85
   Indicators: high_amount, unusual_location, new_device
   ✓ Alert created: alert_1234567890_123
```

## Troubleshooting

### Connection Issues

**Error**: "MongoServerError: bad auth"
- **Solution**: Check username/password in connection string

**Error**: "MongoServerError: IP not in whitelist"
- **Solution**: Add your IP address in Atlas Network Access

### Stream Processor Issues

**Processor not starting**:
- Check that cluster is M10 or higher
- Verify pipeline syntax is valid
- Check source and sink collections exist

**No documents processed**:
- Verify transactions have `status: "pending"`
- Check processor logs in Atlas UI
- Ensure source collection has data

### Application Issues

**No fraud alerts appearing**:
- Check that stream processor is running
- Verify processed_transactions collection has data
- Ensure transactions have high fraud scores

## Next Steps

1. **Customize fraud rules** in `config/atlas-config.js`
2. **Add notification integrations** (email, SMS, webhooks)
3. **Create dashboards** in MongoDB Charts
4. **Set up monitoring** and alerting
5. **Deploy to production** environment

## Support

- MongoDB Atlas Documentation: https://docs.atlas.mongodb.com/
- Stream Processing Guide: https://www.mongodb.com/docs/atlas/atlas-stream-processing/
- Community Forums: https://www.mongodb.com/community/forums/

