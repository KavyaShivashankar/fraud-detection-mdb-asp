/**
 * Fraud Detection Engine
 * 
 * Core fraud detection logic and rules engine
 */

const config = require('../config/atlas-config');

class FraudDetector {
  constructor() {
    this.thresholds = config.fraudDetection.thresholds;
    this.velocityLimits = config.fraudDetection.velocity;
    this.geoSettings = config.fraudDetection.geographic;
  }

  /**
   * Analyze a transaction for fraud indicators
   * @param {Object} transaction - The transaction to analyze
   * @param {Object} userProfile - The user's profile with historical patterns
   * @param {Array} recentTransactions - Recent transactions by the user
   * @returns {Object} Fraud analysis result
   */
  analyzeTransaction(transaction, userProfile, recentTransactions = []) {
    const indicators = [];
    let fraudScore = 0;

    // 1. Amount-based checks
    const amountCheck = this.checkAmount(transaction, userProfile);
    if (amountCheck.isSuspicious) {
      indicators.push(amountCheck);
      fraudScore += amountCheck.score;
    }

    // 2. Velocity checks
    const velocityCheck = this.checkVelocity(transaction, recentTransactions);
    if (velocityCheck.isSuspicious) {
      indicators.push(velocityCheck);
      fraudScore += velocityCheck.score;
    }

    // 3. Geographic checks
    const geoCheck = this.checkGeography(transaction, userProfile, recentTransactions);
    if (geoCheck.isSuspicious) {
      indicators.push(geoCheck);
      fraudScore += geoCheck.score;
    }

    // 4. Device checks
    const deviceCheck = this.checkDevice(transaction, userProfile);
    if (deviceCheck.isSuspicious) {
      indicators.push(deviceCheck);
      fraudScore += deviceCheck.score;
    }

    // 5. Merchant checks
    const merchantCheck = this.checkMerchant(transaction, userProfile);
    if (merchantCheck.isSuspicious) {
      indicators.push(merchantCheck);
      fraudScore += merchantCheck.score;
    }

    // 6. Time-based checks
    const timeCheck = this.checkTransactionTime(transaction, userProfile);
    if (timeCheck.isSuspicious) {
      indicators.push(timeCheck);
      fraudScore += timeCheck.score;
    }

    // Cap fraud score at 100
    fraudScore = Math.min(fraudScore, 100);

    // Determine severity
    const severity = this.determineSeverity(fraudScore);

    return {
      fraudScore,
      severity,
      isFraudulent: fraudScore >= this.thresholds.high,
      indicators: indicators.map(ind => ({
        type: ind.type,
        description: ind.description,
        score: ind.score
      })),
      recommendation: this.getRecommendation(fraudScore, indicators)
    };
  }

  /**
   * Check if transaction amount is suspicious
   */
  checkAmount(transaction, userProfile) {
    const result = {
      type: 'amount_check',
      isSuspicious: false,
      score: 0,
      description: ''
    };

    if (!userProfile || !userProfile.patterns) {
      return result;
    }

    const avgAmount = userProfile.patterns.avg_transaction_amount;
    const multiplier = config.fraudDetection.amountDeviationMultiplier;

    if (transaction.amount > avgAmount * multiplier) {
      result.isSuspicious = true;
      result.score = 25;
      result.description = `Transaction amount ($${transaction.amount}) is ${multiplier}x higher than average ($${avgAmount})`;
    }

    // Check against account limits
    if (transaction.amount > userProfile.limits.single_transaction_limit) {
      result.isSuspicious = true;
      result.score = 30;
      result.description = `Transaction exceeds single transaction limit ($${userProfile.limits.single_transaction_limit})`;
    }

    return result;
  }

  /**
   * Check transaction velocity (frequency and amount)
   */
  checkVelocity(transaction, recentTransactions) {
    const result = {
      type: 'velocity_check',
      isSuspicious: false,
      score: 0,
      description: ''
    };

    const now = new Date(transaction.timestamp);
    const oneHourAgo = new Date(now.getTime() - 3600000);
    const oneDayAgo = new Date(now.getTime() - 86400000);

    // Transactions in last hour
    const lastHourTxns = recentTransactions.filter(t => 
      new Date(t.timestamp) >= oneHourAgo
    );

    // Transactions in last day
    const lastDayTxns = recentTransactions.filter(t => 
      new Date(t.timestamp) >= oneDayAgo
    );

    // Check transaction count
    if (lastHourTxns.length >= this.velocityLimits.maxTransactionsPerHour) {
      result.isSuspicious = true;
      result.score = 30;
      result.description = `${lastHourTxns.length} transactions in last hour (limit: ${this.velocityLimits.maxTransactionsPerHour})`;
    }

    // Check total amount
    const lastHourAmount = lastHourTxns.reduce((sum, t) => sum + t.amount, 0);
    if (lastHourAmount >= this.velocityLimits.maxAmountPerHour) {
      result.isSuspicious = true;
      result.score = Math.max(result.score, 25);
      result.description += ` Total amount in last hour: $${lastHourAmount}`;
    }

    return result;
  }

  /**
   * Check geographic anomalies
   */
  checkGeography(transaction, userProfile, recentTransactions) {
    const result = {
      type: 'geographic_check',
      isSuspicious: false,
      score: 0,
      description: ''
    };

    // Check high-risk countries
    if (this.geoSettings.highRiskCountries.includes(transaction.location.country)) {
      result.isSuspicious = true;
      result.score = 20;
      result.description = `Transaction from high-risk country: ${transaction.location.country}`;
    }

    // Check if location is unusual for user
    if (userProfile && userProfile.patterns && userProfile.patterns.frequent_locations) {
      const frequentCountries = userProfile.patterns.frequent_locations.map(loc => loc.country);
      if (!frequentCountries.includes(transaction.location.country)) {
        result.isSuspicious = true;
        result.score = Math.max(result.score, 30);
        result.description = `Unusual location: ${transaction.location.country}`;
      }
    }

    return result;
  }

  /**
   * Check device fingerprint
   */
  checkDevice(transaction, userProfile) {
    const result = {
      type: 'device_check',
      isSuspicious: false,
      score: 0,
      description: ''
    };

    if (!userProfile || !userProfile.patterns || !userProfile.patterns.known_devices) {
      return result;
    }

    if (!userProfile.patterns.known_devices.includes(transaction.device.device_id)) {
      result.isSuspicious = true;
      result.score = 20;
      result.description = `New device detected: ${transaction.device.device_type}`;
    }

    return result;
  }

  /**
   * Check merchant patterns
   */
  checkMerchant(transaction, userProfile) {
    const result = {
      type: 'merchant_check',
      isSuspicious: false,
      score: 0,
      description: ''
    };

    // Check if merchant is in user's frequent merchants
    if (userProfile && userProfile.patterns && userProfile.patterns.frequent_merchants) {
      const frequentMerchantIds = userProfile.patterns.frequent_merchants.map(m => m.merchant_id);

      // New merchant with high amount
      if (!frequentMerchantIds.includes(transaction.merchant.merchant_id) &&
          transaction.amount > 500) {
        result.isSuspicious = true;
        result.score = 15;
        result.description = `Large transaction with new merchant: ${transaction.merchant.merchant_name}`;
      }
    }

    return result;
  }

  /**
   * Check transaction time patterns
   */
  checkTransactionTime(transaction, userProfile) {
    const result = {
      type: 'time_check',
      isSuspicious: false,
      score: 0,
      description: ''
    };

    const hour = new Date(transaction.timestamp).getHours();

    // Check if transaction is during unusual hours (2 AM - 5 AM)
    if (hour >= 2 && hour <= 5) {
      result.isSuspicious = true;
      result.score = 10;
      result.description = `Transaction during unusual hours: ${hour}:00`;
    }

    // Check against user's common transaction hours
    if (userProfile && userProfile.patterns && userProfile.patterns.common_transaction_hours) {
      if (!userProfile.patterns.common_transaction_hours.includes(hour)) {
        result.isSuspicious = true;
        result.score = Math.max(result.score, 15);
        result.description = `Transaction outside typical hours for user`;
      }
    }

    return result;
  }

  /**
   * Determine severity level based on fraud score
   */
  determineSeverity(fraudScore) {
    if (fraudScore >= this.thresholds.critical) return 'critical';
    if (fraudScore >= this.thresholds.high) return 'high';
    if (fraudScore >= this.thresholds.medium) return 'medium';
    if (fraudScore >= this.thresholds.low) return 'low';
    return 'none';
  }

  /**
   * Get recommendation based on fraud analysis
   */
  getRecommendation(fraudScore, indicators) {
    if (fraudScore >= this.thresholds.critical) {
      return {
        action: 'block',
        message: 'Block transaction immediately and notify user',
        requiresReview: true
      };
    }

    if (fraudScore >= this.thresholds.high) {
      return {
        action: 'flag',
        message: 'Flag transaction for review and request additional verification',
        requiresReview: true
      };
    }

    if (fraudScore >= this.thresholds.medium) {
      return {
        action: 'monitor',
        message: 'Allow transaction but monitor closely',
        requiresReview: false
      };
    }

    return {
      action: 'allow',
      message: 'Transaction appears legitimate',
      requiresReview: false
    };
  }
}

module.exports = FraudDetector;
