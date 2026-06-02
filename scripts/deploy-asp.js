
sp.createStreamProcessor("fraud-detection-processor", [
  { $source: { connectionName: "democluster", db: "fraud_detection", coll: "transactions" } },
  { $match: { operationType: { $in: ["insert", "update", "replace"] } } },
  { $addFields: { "fullDocument.processed_at": "$wallTime" } },
  { $replaceRoot: { newRoot: "$fullDocument" } },
  { $match: { status: "pending" } },
  { $lookup: { as: "user_profile", foreignField: "user_id", from: { connectionName: "democluster", db: "fraud_detection", coll: "user_profiles" }, localField: "user_id" } },
  { $unwind: { path: "$user_profile", preserveNullAndEmptyArrays: true } },
  { $addFields: { fraud_indicators: [], fraud_score: 0 } },
  { $addFields: { fraud_indicators: { $concatArrays: ["$fraud_indicators", { $cond: [{ $and: [{ $ifNull: ["$user_profile.patterns.avg_transaction_amount", false] }, { $gt: ["$amount", { $multiply: ["$user_profile.patterns.avg_transaction_amount", 3] }] }] }, ["high_amount"], []] }] } } },
  { $addFields: { fraud_indicators: { $concatArrays: ["$fraud_indicators", { $cond: [{ $and: [{ $ifNull: ["$user_profile.patterns.frequent_locations", false] }, { $not: { $in: ["$location.country", { $map: { input: "$user_profile.patterns.frequent_locations", as: "loc", in: "$$loc.country" } }] } }] }, ["unusual_location"], []] }] } } },
  { $addFields: { fraud_indicators: { $concatArrays: ["$fraud_indicators", { $cond: [{ $and: [{ $ifNull: ["$user_profile.patterns.known_devices", false] }, { $not: { $in: ["$device.device_id", "$user_profile.patterns.known_devices"] } }] }, ["new_device"], []] }] } } },
  { $addFields: { fraud_score: { $add: [{ $cond: [{ $in: ["high_amount", "$fraud_indicators"] }, 25, 0] }, { $cond: [{ $in: ["unusual_location", "$fraud_indicators"] }, 30, 0] }, { $cond: [{ $in: ["new_device", "$fraud_indicators"] }, 20, 0] }] } } },
  { $addFields: {
      is_fraudulent: { $gte: ["$fraud_score", 70] },
      status: { $cond: [{ $gte: ["$fraud_score", 70] }, "flagged", "completed"] },
      fraud_alert: { $cond: [{ $gte: ["$fraud_score", 70] }, { is_fraudulent: true, processed_transaction_id: "$_id" }, null] }
  }},
  { $merge: {
      into: { connectionName: "democluster", db: "fraud_detection", coll: "transactions" },
      on: "transaction_id",
      whenMatched: [{ $set: {
          status: "$$new.status",
          is_fraudulent: "$$new.is_fraudulent",
          fraud_score: "$$new.fraud_score",
          fraud_indicators: "$$new.fraud_indicators",
          processed_at: "$$new.processed_at",
          fraud_alert: { $cond: ["$$new.is_fraudulent", "$$new.fraud_alert", "$$REMOVE"] }
      }}],
      whenNotMatched: "discard"
  }}
])

sp.createStreamProcessor("fraud-processed-processor", [
  { $source: { connectionName: "democluster", db: "fraud_detection", coll: "transactions" } },
  { $match: { operationType: { $in: ["update", "replace"] } } },
  { $lookup: {
      from: { connectionName: "democluster", db: "fraud_detection", coll: "transactions" },
      localField: "documentKey._id",
      foreignField: "_id",
      as: "doc"
  }},
  { $unwind: "$doc" },
  { $replaceRoot: { newRoot: "$doc" } },
  { $match: { status: "flagged" } },
  { $merge: {
      into: { connectionName: "democluster", db: "fraud_detection", coll: "fraud_transactions" },
      on: "transaction_id",
      whenMatched: "replace",
      whenNotMatched: "insert"
  }}
])