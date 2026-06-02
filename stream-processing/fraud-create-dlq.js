// prerequisites:
// 1. Create a connection to your stream processing cluster
//. eg. mongosh "mongodb://atlas-stream-xxxxxxx-rawu8i.oregon-usa.a.query.mongodb.net/" --tls --authenticationDatabase admin --username ks_db_user --password <password>

// 2. Define your DLQ routing options
const processorOptions = {
  dlq: {
    connectionName: "democluster",
    db: "fraud_detection",
    coll: "dlq" // MongoDB will automatically route failed messages here
  }
};

// 3. Define your fixed pipeline
const fraudPipeline = [ ]

// 4. Create the stream processor, passing the pipeline and the options
sp.createStreamProcessor("fraud_detector", fraudPipeline, processorOptions);

// 4. Start the stream processor.  You can also alternately start it from the Atlas UI, but this is how you would do it programmatically.
sp.fraud_detector.start();

// 5. To drop stream processor and clean up resources when done
sp.fraud_detector.drop();