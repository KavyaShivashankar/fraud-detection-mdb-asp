# Fraud Detection System with MongoDB Atlas Stream Processing

A real-time fraud detection system built with MongoDB Atlas Stream Processing that analyzes financial transactions and identifies potentially fraudulent activity.

## 🏗️ Architecture

This system uses MongoDB Atlas Stream Processing to analyze transactions in real-time as they are inserted into the database. The stream processing pipeline:

1. **Monitors** incoming transactions from the `transactions` collection
2. **Enriches** transaction data with user profile information
3. **Calculates** fraud scores based on multiple indicators
4. **Flags** suspicious transactions automatically
5. **Outputs** processed transactions to the `processed_transactions` collection

## 📊 Data Models

### Transaction
- Transaction details (amount, currency, type)
- Merchant information
- Location data (with geospatial coordinates)
- Device fingerprint
- Payment method details
- Fraud detection results

### User Profile
- User identification and status
- Historical transaction patterns
- Risk profile
- Account limits
- Known devices and locations

### Fraud Alert
- Alert metadata and severity
- Fraud indicators and scores
- Investigation tracking
- Automated actions taken
- Notification status

## 🔍 Fraud Detection Rules

The system detects fraud using multiple indicators:

1. **Amount Anomaly**: Transactions significantly higher than user's average
2. **Velocity Check**: Too many transactions in a short time period
3. **Geographic Anomaly**: Transactions from unusual or high-risk locations
4. **Device Fingerprint**: Transactions from unknown devices
5. **Merchant Pattern**: Large transactions with new merchants
6. **Time Pattern**: Transactions during unusual hours

Each indicator contributes to an overall fraud score (0-100), with thresholds:
- **Low Risk**: 0-29
- **Medium Risk**: 30-49
- **High Risk**: 50-69
- **Critical**: 70-100

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ installed
- MongoDB Atlas account with a cluster
- Atlas Stream Processing enabled on your cluster

### Installation

1. Clone this repository:
```bash
git clone <repository-url>
cd fraud_detection_example
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

Edit `.env` and add your MongoDB Atlas connection string:
```
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
```

### Generate Sample Data

Generate sample users and transactions for testing:

```bash
npm run generate-data
```

This creates:
- 50 user profiles with realistic patterns
- 1,000 transactions (5% potentially fraudulent)
- Necessary indexes for optimal performance

## 📡 Deploy Stream Processing Pipeline

### Option 1: Using Atlas UI

1. Log in to MongoDB Atlas
2. Navigate to your cluster
3. Click on "Stream Processing" in the left sidebar
  a. Create a workspace if you haven't already
  b. Create a connection to your cluster
4. Click "Create Stream Processor"
5. Name it `fraud-detection-processor`
6. Copy the pipeline from `stream-processing/fraud-detection-pipeline.json`
7. Configure:
   - **Source**: `fraud_detection.transactions`
   - **Sink**: `fraud_detection.processed_transactions`
8. Click "Start Processor"

### Option 2: Using Atlas CLI

```bash
# Set your Atlas project ID
export ATLAS_PROJECT_ID=your-project-id

# Run the deployment script
cd stream-processing
chmod +x deploy-stream-processor.sh
./deploy-stream-processor.sh
```

## 🏃 Running the Application

Start the fraud detection monitoring application:

```bash
npm start
```

The application will:
- Connect to your Atlas cluster
- Display a dashboard with fraud statistics
- Monitor processed transactions in real-time
- Create fraud alerts for suspicious transactions

## 📁 Project Structure

```
fraud_detection_example/
├── config/
│   └── atlas-config.js          # MongoDB Atlas configuration
├── models/
│   ├── transaction.js            # Transaction data model
│   ├── user.js                   # User profile data model
│   └── fraud_alert.js            # Fraud alert data model
├── src/
│   ├── index.js                  # Main application
│   └── fraud-detector.js         # Fraud detection engine
├── scripts/
│   └── generate-sample-data.js   # Sample data generator
├── stream-processing/
│   ├── fraud-detection-pipeline.js    # Stream processing pipeline (JS)
│   ├── fraud-detection-pipeline.json  # Stream processing pipeline (JSON)
│   └── deploy-stream-processor.sh     # Deployment script
├── .env.example                  # Environment variables template
├── package.json                  # Node.js dependencies
└── README.md                     # This file
```

## 🔧 Configuration

Edit `config/atlas-config.js` to customize:

- **Fraud thresholds**: Adjust score thresholds for different severity levels
- **Velocity limits**: Set maximum transactions per hour/day
- **Geographic settings**: Configure high-risk countries
- **Device limits**: Set maximum devices per user
- **Notification settings**: Configure email, SMS, and webhook alerts

## 📈 Monitoring

### View Fraud Statistics

The application displays real-time statistics including:
- Total transactions processed
- Number of fraudulent transactions detected
- Average fraud score
- Alerts by severity and status

### Query Fraud Alerts

```javascript
// Find all open high-severity alerts
db.fraud_alerts.find({
  status: "open",
  severity: "high"
})

// Find alerts for a specific user
db.fraud_alerts.find({
  user_id: "user_00001"
})
```

## 🧪 Testing

Insert a test transaction to trigger fraud detection:

```javascript
db.transactions.insertOne({
  transaction_id: "txn_test_001",
  timestamp: new Date(),
  user_id: "user_00001",
  account_id: "acc_12345",
  amount: 15000,  // High amount
  currency: "USD",
  transaction_type: "purchase",
  merchant: {
    merchant_id: "merch_999",
    merchant_name: "Unknown Merchant",
    merchant_category: "5999",
    merchant_country: "NG"  // High-risk country
  },
  location: {
    ip_address: "192.168.1.1",
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
## To debug stream processing pipeline
```javascript
    sp.process([{
    "$source": {
      "coll": "transactions",
      "connectionName": "democluster",
      "db": "fraud_detection"
    }
  }])
```

```javascript
sp["fp_fulldoc_dql_v2"].stats({verbose:true})
sp["fp_fulldoc_dql_v2"].stop()
sp["fp_fulldoc_dql_v2"].start()
sp["fp_fulldoc_dql_v2"].drop()
```



## 📚 Learn More

- [MongoDB Atlas Stream Processing Documentation](https://www.mongodb.com/docs/atlas/atlas-stream-processing/)
- [MongoDB Aggregation Pipeline](https://www.mongodb.com/docs/manual/aggregation/)
- [Change Streams](https://www.mongodb.com/docs/manual/changeStreams/)

## 📝 License

MIT

