# Fraud Detection System Architecture

## Overview

This fraud detection system leverages MongoDB Atlas Stream Processing to analyze financial transactions in real-time and identify potentially fraudulent activity.

## System Components

### 1. Data Layer (MongoDB Atlas)

**Collections:**
- `transactions`: Incoming transaction data
- `user_profiles`: User historical patterns and risk profiles
- `processed_transactions`: Transactions with fraud scores
- `fraud_alerts`: Generated alerts for suspicious activity
- `processing_errors`: Dead letter queue for failed processing

**Indexes:**
- `transactions`: `{user_id: 1, timestamp: -1}`, `{status: 1}`, `{timestamp: -1}`
- `user_profiles`: `{user_id: 1}` (unique), `{email: 1}` (unique)
- Geospatial index on `location.coordinates` for proximity queries

### 2. Stream Processing Layer

**MongoDB Atlas Stream Processor:**
- Continuously monitors the `transactions` collection
- Processes transactions through an aggregation pipeline
- Enriches data with user profile information
- Calculates fraud scores in real-time
- Outputs results to `processed_transactions` collection

**Pipeline Stages:**
1. **$source**: Connect to transactions collection
2. **$match**: Filter pending transactions
3. **$lookup**: Join with user profiles
4. **$addFields**: Calculate fraud indicators
5. **$addFields**: Compute fraud score
6. **$addFields**: Determine fraud status
7. **$merge**: Write to processed_transactions

### 3. Application Layer

**Fraud Detection Engine (`fraud-detector.js`):**
- Implements fraud detection rules
- Analyzes transactions against user patterns
- Calculates fraud scores based on multiple indicators
- Provides recommendations for actions

**Main Application (`index.js`):**
- Monitors processed transactions using Change Streams
- Creates fraud alerts for flagged transactions
- Displays real-time dashboard
- Manages notifications

## Data Flow

```
┌─────────────────┐
│   Transaction   │
│     Source      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Transactions   │
│   Collection    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Stream Processor│◄──────┐
│   (Real-time)   │       │
└────────┬────────┘       │
         │                │
         │           ┌────┴─────┐
         │           │   User   │
         │           │ Profiles │
         │           └──────────┘
         ▼
┌─────────────────┐
│   Processed     │
│  Transactions   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Change Stream   │
│   Monitoring    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Fraud Alerts   │
│   Collection    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Notifications  │
│ (Email/SMS/Web) │
└─────────────────┘
```

## Fraud Detection Algorithm

### Scoring System

Each transaction is evaluated against multiple fraud indicators:

| Indicator | Weight | Description |
|-----------|--------|-------------|
| High Amount | 25 | Transaction amount 3x+ higher than average |
| Unusual Location | 30 | Transaction from new or high-risk country |
| New Device | 20 | Transaction from unknown device |
| High Velocity | 30 | Too many transactions in short period |
| Large Amount Velocity | 25 | High total amount in short period |
| New Merchant | 15 | Large transaction with unfamiliar merchant |
| Unusual Time | 15 | Transaction during atypical hours |

**Total Score Range**: 0-100 (capped)

### Risk Levels

- **None** (0-29): Transaction appears legitimate
- **Low** (30-49): Minor anomalies detected
- **Medium** (50-69): Multiple anomalies, monitor closely
- **High** (70-84): Likely fraudulent, flag for review
- **Critical** (85-100): Block transaction immediately

### Actions by Risk Level

| Risk Level | Automated Action | Manual Review |
|------------|------------------|---------------|
| None | Allow | No |
| Low | Allow | No |
| Medium | Allow + Monitor | Optional |
| High | Flag + Verify | Yes |
| Critical | Block | Yes |

## Real-time Processing

### Stream Processing Benefits

1. **Low Latency**: Transactions analyzed within milliseconds
2. **Scalability**: Handles thousands of transactions per second
3. **Consistency**: All transactions processed through same pipeline
4. **Reliability**: Built-in error handling and dead letter queue

### Change Streams

The application uses MongoDB Change Streams to:
- Monitor processed transactions in real-time
- React immediately to fraud detection
- Create alerts without polling
- Trigger notifications instantly

## Scalability Considerations

### Horizontal Scaling

- **Atlas Cluster**: Auto-scaling based on workload
- **Stream Processor**: Distributed processing across nodes
- **Application**: Stateless design allows multiple instances

### Performance Optimization

1. **Indexes**: Optimized for common query patterns
2. **Aggregation**: Pipeline stages minimize data transfer
3. **Caching**: User profiles cached in stream processor
4. **Batching**: Notifications batched to reduce API calls

## Security

### Data Protection

- **Encryption**: Data encrypted at rest and in transit
- **Authentication**: MongoDB authentication required
- **Authorization**: Role-based access control
- **Audit**: All fraud alerts logged for compliance

### PII Handling

- Card numbers stored as last 4 digits only
- IP addresses hashed for privacy
- User data access logged
- GDPR-compliant data retention

## Monitoring & Observability

### Metrics to Track

1. **Processing Metrics**:
   - Transactions processed per second
   - Average processing latency
   - Error rate

2. **Fraud Metrics**:
   - Fraud detection rate
   - False positive rate
   - Average fraud score

3. **System Metrics**:
   - Database connections
   - Memory usage
   - CPU utilization

### Alerting

- High error rate in stream processor
- Spike in fraud detections
- Processing lag exceeding threshold
- Database connection failures

## Future Enhancements

1. **Machine Learning**: Train ML models on historical fraud patterns
2. **Graph Analysis**: Detect fraud rings using connected transactions
3. **Behavioral Biometrics**: Analyze typing patterns and mouse movements
4. **External Data**: Integrate with fraud databases and blacklists
5. **A/B Testing**: Test different fraud detection rules
6. **Feedback Loop**: Learn from false positives/negatives

