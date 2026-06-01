# Useful MongoDB Queries for Fraud Detection

This document contains useful queries for analyzing fraud detection data.

## Transaction Queries

### Find All Pending Transactions
```javascript
db.transactions.find({ status: "pending" })
```

### Find High-Value Transactions
```javascript
db.transactions.find({ 
  amount: { $gte: 1000 } 
}).sort({ amount: -1 })
```

### Find Transactions by User
```javascript
db.transactions.find({ 
  user_id: "user_00001" 
}).sort({ timestamp: -1 })
```

### Find Transactions in Last Hour
```javascript
db.transactions.find({
  timestamp: { 
    $gte: new Date(Date.now() - 3600000) 
  }
})
```

### Find Transactions from Specific Country
```javascript
db.transactions.find({ 
  "location.country": "US" 
})
```

### Find Transactions Near a Location (Geospatial)
```javascript
db.transactions.find({
  "location.coordinates": {
    $near: {
      $geometry: {
        type: "Point",
        coordinates: [-74.0060, 40.7128]  // New York
      },
      $maxDistance: 10000  // 10km in meters
    }
  }
})
```

## Processed Transaction Queries

### Find All Fraudulent Transactions
```javascript
db.processed_transactions.find({ 
  is_fraudulent: true 
}).sort({ fraud_score: -1 })
```

### Find Transactions by Fraud Score Range
```javascript
db.processed_transactions.find({
  fraud_score: { $gte: 70, $lte: 100 }
})
```

### Find Transactions with Specific Fraud Indicator
```javascript
db.processed_transactions.find({
  fraud_indicators: "unusual_location"
})
```

### Count Transactions by Status
```javascript
db.processed_transactions.aggregate([
  {
    $group: {
      _id: "$status",
      count: { $sum: 1 }
    }
  }
])
```

## Fraud Alert Queries

### Find All Open Alerts
```javascript
db.fraud_alerts.find({ 
  status: "open" 
}).sort({ created_at: -1 })
```

### Find High-Severity Alerts
```javascript
db.fraud_alerts.find({ 
  severity: { $in: ["high", "critical"] },
  status: "open"
})
```

### Find Alerts for Specific User
```javascript
db.fraud_alerts.find({ 
  user_id: "user_00001" 
}).sort({ created_at: -1 })
```

### Count Alerts by Severity
```javascript
db.fraud_alerts.aggregate([
  {
    $group: {
      _id: "$severity",
      count: { $sum: 1 }
    }
  },
  {
    $sort: { count: -1 }
  }
])
```

## User Profile Queries

### Find User Profile
```javascript
db.user_profiles.findOne({ 
  user_id: "user_00001" 
})
```

### Find High-Risk Users
```javascript
db.user_profiles.find({
  "risk_profile.risk_level": { $in: ["high", "critical"] }
})
```

### Find Users with Fraud History
```javascript
db.user_profiles.find({
  "risk_profile.fraud_history": { $ne: [] }
})
```

## Analytics Queries

### Daily Transaction Volume
```javascript
db.processed_transactions.aggregate([
  {
    $group: {
      _id: {
        $dateToString: { format: "%Y-%m-%d", date: "$timestamp" }
      },
      total_transactions: { $sum: 1 },
      total_amount: { $sum: "$amount" },
      fraudulent_count: {
        $sum: { $cond: ["$is_fraudulent", 1, 0] }
      }
    }
  },
  {
    $sort: { _id: -1 }
  }
])
```

### Fraud Rate by Country
```javascript
db.processed_transactions.aggregate([
  {
    $group: {
      _id: "$location.country",
      total: { $sum: 1 },
      fraudulent: {
        $sum: { $cond: ["$is_fraudulent", 1, 0] }
      }
    }
  },
  {
    $addFields: {
      fraud_rate: {
        $multiply: [
          { $divide: ["$fraudulent", "$total"] },
          100
        ]
      }
    }
  },
  {
    $sort: { fraud_rate: -1 }
  }
])
```

### Average Fraud Score by Merchant
```javascript
db.processed_transactions.aggregate([
  {
    $group: {
      _id: "$merchant.merchant_name",
      avg_fraud_score: { $avg: "$fraud_score" },
      transaction_count: { $sum: 1 },
      fraudulent_count: {
        $sum: { $cond: ["$is_fraudulent", 1, 0] }
      }
    }
  },
  {
    $sort: { avg_fraud_score: -1 }
  }
])
```

### Hourly Transaction Pattern
```javascript
db.processed_transactions.aggregate([
  {
    $group: {
      _id: { $hour: "$timestamp" },
      count: { $sum: 1 },
      avg_amount: { $avg: "$amount" },
      fraud_count: {
        $sum: { $cond: ["$is_fraudulent", 1, 0] }
      }
    }
  },
  {
    $sort: { _id: 1 }
  }
])
```

### Top Fraud Indicators
```javascript
db.processed_transactions.aggregate([
  {
    $match: { is_fraudulent: true }
  },
  {
    $unwind: "$fraud_indicators"
  },
  {
    $group: {
      _id: "$fraud_indicators",
      count: { $sum: 1 }
    }
  },
  {
    $sort: { count: -1 }
  }
])
```

### User Transaction Velocity
```javascript
db.processed_transactions.aggregate([
  {
    $match: {
      timestamp: { $gte: new Date(Date.now() - 86400000) }  // Last 24 hours
    }
  },
  {
    $group: {
      _id: "$user_id",
      transaction_count: { $sum: 1 },
      total_amount: { $sum: "$amount" },
      avg_fraud_score: { $avg: "$fraud_score" }
    }
  },
  {
    $match: {
      transaction_count: { $gte: 10 }  // Users with 10+ transactions
    }
  },
  {
    $sort: { transaction_count: -1 }
  }
])
```

## Update Queries

### Update Alert Status
```javascript
db.fraud_alerts.updateOne(
  { alert_id: "alert_abc123" },
  {
    $set: {
      status: "investigating",
      "investigation.assigned_to": "analyst_001",
      "investigation.notes": ["Started investigation"]
    }
  }
)
```

### Mark Alert as False Positive
```javascript
db.fraud_alerts.updateOne(
  { alert_id: "alert_abc123" },
  {
    $set: {
      status: "false_positive",
      "investigation.resolution_date": new Date(),
      "investigation.resolution_notes": "Verified with customer - legitimate transaction"
    }
  }
)
```

### Update User Risk Profile
```javascript
db.user_profiles.updateOne(
  { user_id: "user_00001" },
  {
    $set: {
      "risk_profile.risk_level": "high",
      "risk_profile.risk_score": 75,
      "risk_profile.last_updated": new Date()
    },
    $push: {
      "risk_profile.fraud_history": {
        incident_date: new Date(),
        transaction_id: "txn_123",
        fraud_type: "unusual_location",
        resolved: false
      }
    }
  }
)
```

## Monitoring Queries

### Stream Processor Health Check
```javascript
// Check for processing errors
db.processing_errors.find().sort({ _id: -1 }).limit(10)
```

### Recent Fraud Alerts
```javascript
db.fraud_alerts.find({
  created_at: { $gte: new Date(Date.now() - 3600000) }  // Last hour
}).sort({ created_at: -1 })
```

### System Statistics
```javascript
db.processed_transactions.aggregate([
  {
    $facet: {
      total_stats: [
        {
          $group: {
            _id: null,
            total_transactions: { $sum: 1 },
            total_amount: { $sum: "$amount" },
            avg_fraud_score: { $avg: "$fraud_score" }
          }
        }
      ],
      fraud_stats: [
        {
          $match: { is_fraudulent: true }
        },
        {
          $group: {
            _id: null,
            fraudulent_count: { $sum: 1 },
            fraudulent_amount: { $sum: "$amount" }
          }
        }
      ],
      status_breakdown: [
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 }
          }
        }
      ]
    }
  }
])
```

