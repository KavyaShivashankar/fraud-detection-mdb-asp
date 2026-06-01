/**
 * Fraud Detection System - Main Application
 * 
 * Monitors transactions and processes fraud alerts
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const config = require('../config/atlas-config');
const FraudDetector = require('./fraud-detector');

class FraudDetectionApp {
  constructor() {
    this.client = null;
    this.db = null;
    this.fraudDetector = new FraudDetector();
  }

  /**
   * Connect to MongoDB Atlas
   */
  async connect() {
    const uri = config.atlas.connectionString;
    this.client = new MongoClient(uri, config.atlas.options);
    
    try {
      await this.client.connect();
      this.db = this.client.db(config.atlas.database);
      console.log('✓ Connected to MongoDB Atlas');
      return true;
    } catch (error) {
      console.error('Failed to connect to MongoDB:', error);
      throw error;
    }
  }

  /**
   * Monitor processed transactions and create fraud alerts
   */
  async monitorProcessedTransactions() {
    const processedCollection = this.db.collection(config.atlas.collections.processedTransactions);
    const alertsCollection = this.db.collection(config.atlas.collections.fraudAlerts);

    console.log('\n🔍 Monitoring processed transactions for fraud...\n');

    // Use change streams to monitor in real-time
    const changeStream = processedCollection.watch([
      {
        $match: {
          operationType: { $in: ['insert', 'update'] },
          'fullDocument.is_fraudulent': true
        }
      }
    ]);

    changeStream.on('change', async (change) => {
      const transaction = change.fullDocument;
      
      console.log(`🚨 Fraud detected: ${transaction.transaction_id}`);
      console.log(`   Score: ${transaction.fraud_score}`);
      console.log(`   Indicators: ${transaction.fraud_indicators.join(', ')}`);

      // Create fraud alert
      const alert = {
        alert_id: `alert_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        transaction_id: transaction.transaction_id,
        created_at: new Date(),
        user_id: transaction.user_id,
        account_id: transaction.account_id,
        severity: this.fraudDetector.determineSeverity(transaction.fraud_score),
        fraud_score: transaction.fraud_score,
        fraud_indicators: transaction.fraud_indicators.map(ind => ({
          indicator_type: ind,
          description: ind.replace(/_/g, ' '),
          score_contribution: 0
        })),
        transaction_summary: {
          amount: transaction.amount,
          currency: transaction.currency,
          merchant_name: transaction.merchant.merchant_name,
          location: `${transaction.location.city}, ${transaction.location.country}`,
          timestamp: transaction.timestamp
        },
        status: 'open',
        investigation: {
          assigned_to: null,
          notes: [],
          actions_taken: [],
          resolution_date: null,
          resolution_notes: null
        },
        automated_actions: [
          {
            action_type: 'flag_transaction',
            timestamp: new Date(),
            success: true
          }
        ],
        notifications_sent: []
      };

      await alertsCollection.insertOne(alert);
      console.log(`   ✓ Alert created: ${alert.alert_id}\n`);
    });

    changeStream.on('error', (error) => {
      console.error('Change stream error:', error);
    });
  }

  /**
   * Get fraud statistics
   */
  async getFraudStats() {
    const transactionsCollection = this.db.collection(config.atlas.collections.processedTransactions);
    const alertsCollection = this.db.collection(config.atlas.collections.fraudAlerts);

    const stats = await transactionsCollection.aggregate([
      {
        $facet: {
          total: [{ $count: 'count' }],
          fraudulent: [
            { $match: { is_fraudulent: true } },
            { $count: 'count' }
          ],
          byStatus: [
            { $group: { _id: '$status', count: { $sum: 1 } } }
          ],
          avgFraudScore: [
            { $group: { _id: null, avg: { $avg: '$fraud_score' } } }
          ]
        }
      }
    ]).toArray();

    const alertStats = await alertsCollection.aggregate([
      {
        $facet: {
          total: [{ $count: 'count' }],
          bySeverity: [
            { $group: { _id: '$severity', count: { $sum: 1 } } }
          ],
          byStatus: [
            { $group: { _id: '$status', count: { $sum: 1 } } }
          ]
        }
      }
    ]).toArray();

    return {
      transactions: stats[0],
      alerts: alertStats[0]
    };
  }

  /**
   * Display dashboard
   */
  async displayDashboard() {
    console.log('\n📊 Fraud Detection Dashboard');
    console.log('═══════════════════════════════════════\n');

    const stats = await this.getFraudStats();

    console.log('Transactions:');
    console.log(`  Total: ${stats.transactions.total[0]?.count || 0}`);
    console.log(`  Fraudulent: ${stats.transactions.fraudulent[0]?.count || 0}`);
    console.log(`  Avg Fraud Score: ${stats.transactions.avgFraudScore[0]?.avg?.toFixed(2) || 0}`);
    
    console.log('\nAlerts:');
    console.log(`  Total: ${stats.alerts.total[0]?.count || 0}`);
    
    if (stats.alerts.bySeverity.length > 0) {
      console.log('  By Severity:');
      stats.alerts.bySeverity.forEach(s => {
        console.log(`    ${s._id}: ${s.count}`);
      });
    }

    console.log('\n═══════════════════════════════════════\n');
  }

  /**
   * Start the application
   */
  async start() {
    try {
      await this.connect();
      await this.displayDashboard();
      await this.monitorProcessedTransactions();
    } catch (error) {
      console.error('Application error:', error);
      await this.stop();
      process.exit(1);
    }
  }

  /**
   * Stop the application
   */
  async stop() {
    if (this.client) {
      await this.client.close();
      console.log('✓ Disconnected from MongoDB');
    }
  }
}

// Run the application
if (require.main === module) {
  const app = new FraudDetectionApp();
  
  app.start().catch(console.error);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down...');
    await app.stop();
    process.exit(0);
  });
}

module.exports = FraudDetectionApp;

