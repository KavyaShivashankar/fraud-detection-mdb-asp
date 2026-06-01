/**
 * MongoDB Atlas Stream Processing Pipeline for Fraud Detection
 * 
 * This pipeline processes incoming transactions in real-time and
 * calculates fraud scores based on multiple indicators
 */

const fraudDetectionPipeline = [
  // Stage 1: Match only pending transactions
  {
    $match: {
      status: "pending"
    }
  },
  
  // Stage 2: Lookup user profile for historical patterns
  {
    $lookup: {
      from: "user_profiles",
      localField: "user_id",
      foreignField: "user_id",
      as: "user_profile"
    }
  },
  
  // Stage 3: Unwind user profile
  {
    $unwind: {
      path: "$user_profile",
      preserveNullAndEmptyArrays: true
    }
  },
  
  // Stage 4: Calculate velocity metrics (transactions in last hour)
  {
    $lookup: {
      from: "transactions",
      let: { 
        userId: "$user_id",
        currentTime: "$timestamp"
      },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$user_id", "$$userId"] },
                { 
                  $gte: [
                    "$timestamp",
                    { $subtract: ["$$currentTime", 3600000] } // Last hour
                  ]
                }
              ]
            }
          }
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalAmount: { $sum: "$amount" }
          }
        }
      ],
      as: "velocity_metrics"
    }
  },
  
  // Stage 5: Calculate fraud indicators and score
  {
    $addFields: {
      velocity_data: { $arrayElemAt: ["$velocity_metrics", 0] },
      
      // Calculate individual fraud indicators
      fraud_indicators: {
        $let: {
          vars: {
            indicators: []
          },
          in: {
            $concatArrays: [
              // High amount indicator
              {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$user_profile.patterns.avg_transaction_amount", false] },
                      { 
                        $gt: [
                          "$amount",
                          { $multiply: ["$user_profile.patterns.avg_transaction_amount", 3] }
                        ]
                      }
                    ]
                  },
                  ["high_amount"],
                  []
                ]
              },
              
              // Unusual location indicator
              {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$user_profile.patterns.frequent_locations", false] },
                      {
                        $not: {
                          $in: [
                            "$location.country",
                            { $map: {
                              input: "$user_profile.patterns.frequent_locations",
                              as: "loc",
                              in: "$$loc.country"
                            }}
                          ]
                        }
                      }
                    ]
                  },
                  ["unusual_location"],
                  []
                ]
              },
              
              // New device indicator
              {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$user_profile.patterns.known_devices", false] },
                      { $not: { $in: ["$device.device_id", "$user_profile.patterns.known_devices"] } }
                    ]
                  },
                  ["new_device"],
                  []
                ]
              },
              
              // High velocity indicator
              {
                $cond: [
                  {
                    $gt: [
                      { $ifNull: [{ $arrayElemAt: ["$velocity_metrics.count", 0] }, 0] },
                      10
                    ]
                  },
                  ["high_velocity"],
                  []
                ]
              },
              
              // Large amount velocity indicator
              {
                $cond: [
                  {
                    $gt: [
                      { $ifNull: [{ $arrayElemAt: ["$velocity_metrics.totalAmount", 0] }, 0] },
                      5000
                    ]
                  },
                  ["large_amount_velocity"],
                  []
                ]
              }
            ]
          }
        }
      }
    }
  },
  
  // Stage 6: Calculate fraud score
  {
    $addFields: {
      fraud_score: {
        $let: {
          vars: {
            baseScore: 0,
            highAmountScore: { $cond: [{ $in: ["high_amount", "$fraud_indicators"] }, 25, 0] },
            unusualLocationScore: { $cond: [{ $in: ["unusual_location", "$fraud_indicators"] }, 30, 0] },
            newDeviceScore: { $cond: [{ $in: ["new_device", "$fraud_indicators"] }, 20, 0] },
            highVelocityScore: { $cond: [{ $in: ["high_velocity", "$fraud_indicators"] }, 30, 0] },
            largeAmountVelocityScore: { $cond: [{ $in: ["large_amount_velocity", "$fraud_indicators"] }, 25, 0] }
          },
          in: {
            $add: [
              "$$baseScore",
              "$$highAmountScore",
              "$$unusualLocationScore",
              "$$newDeviceScore",
              "$$highVelocityScore",
              "$$largeAmountVelocityScore"
            ]
          }
        }
      }
    }
  },
  
  // Stage 7: Determine if fraudulent and update status
  {
    $addFields: {
      is_fraudulent: { $gte: ["$fraud_score", 70] },
      status: {
        $cond: [
          { $gte: ["$fraud_score", 70] },
          "flagged",
          "completed"
        ]
      },
      fraud_reason: {
        $cond: [
          { $gte: ["$fraud_score", 70] },
          { $reduce: {
            input: "$fraud_indicators",
            initialValue: "",
            in: {
              $concat: [
                "$$value",
                { $cond: [{ $eq: ["$$value", ""] }, "", ", "] },
                "$$this"
              ]
            }
          }},
          null
        ]
      },
      processed_at: "$$NOW"
    }
  }
];

module.exports = fraudDetectionPipeline;

