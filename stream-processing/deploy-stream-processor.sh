#!/bin/bash

###############################################################################
# MongoDB Atlas Stream Processing Deployment Script
# 
# This script helps deploy the fraud detection stream processor to Atlas
# 
# Prerequisites:
# 1. MongoDB Atlas CLI (atlas-cli) installed
# 2. Authenticated with Atlas CLI: atlas auth login
# 3. Atlas cluster with Stream Processing enabled
###############################################################################

set -e

# Configuration
PROJECT_ID="${ATLAS_PROJECT_ID}"
CLUSTER_NAME="${ATLAS_CLUSTER_NAME:-Cluster0}"
PROCESSOR_NAME="fraud-detection-processor"
DATABASE_NAME="fraud_detection"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}MongoDB Atlas Stream Processing Deployment${NC}"
echo "=============================================="
echo ""

# Check if Atlas CLI is installed
if ! command -v atlas &> /dev/null; then
    echo -e "${RED}Error: MongoDB Atlas CLI is not installed${NC}"
    echo "Please install it from: https://www.mongodb.com/docs/atlas/cli/stable/install-atlas-cli/"
    exit 1
fi

# Check if authenticated
if ! atlas auth whoami &> /dev/null; then
    echo -e "${RED}Error: Not authenticated with Atlas CLI${NC}"
    echo "Please run: atlas auth login"
    exit 1
fi

# Check required environment variables
if [ -z "$PROJECT_ID" ]; then
    echo -e "${YELLOW}Warning: ATLAS_PROJECT_ID not set${NC}"
    echo "Please set it with: export ATLAS_PROJECT_ID=your-project-id"
    echo ""
    echo "Available projects:"
    atlas projects list
    exit 1
fi

echo -e "${GREEN}Step 1: Creating Stream Processor${NC}"
echo "Project ID: $PROJECT_ID"
echo "Processor Name: $PROCESSOR_NAME"
echo ""

# Create the stream processor configuration
cat > /tmp/stream-processor-config.json <<EOF
{
  "name": "$PROCESSOR_NAME",
  "pipeline": $(cat fraud-detection-pipeline.json),
  "options": {
    "dlq": {
      "coll": "processing_errors",
      "db": "$DATABASE_NAME"
    }
  }
}
EOF

echo -e "${GREEN}Step 2: Deploying Stream Processor${NC}"
echo "This will create a new stream processor in your Atlas project"
echo ""

# Note: The actual deployment command depends on Atlas CLI version
# This is a template - adjust based on your Atlas CLI version
echo "To deploy the stream processor, use the Atlas UI or API:"
echo ""
echo "1. Go to Atlas UI > Stream Processing"
echo "2. Click 'Create Stream Processor'"
echo "3. Use the pipeline definition from: stream-processing/fraud-detection-pipeline.js"
echo "4. Configure:"
echo "   - Source: $DATABASE_NAME.transactions"
echo "   - Sink: $DATABASE_NAME.processed_transactions"
echo ""

echo -e "${GREEN}Step 3: Stream Processor Configuration${NC}"
echo "Pipeline stages:"
echo "  1. Filter pending transactions"
echo "  2. Lookup user profiles"
echo "  3. Calculate velocity metrics"
echo "  4. Detect fraud indicators"
echo "  5. Calculate fraud score"
echo "  6. Flag suspicious transactions"
echo ""

echo -e "${GREEN}Deployment preparation complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Review the pipeline in fraud-detection-pipeline.js"
echo "2. Deploy via Atlas UI or API"
echo "3. Start the stream processor"
echo "4. Monitor processing in Atlas UI"
echo ""
echo "For more information, visit:"
echo "https://www.mongodb.com/docs/atlas/atlas-stream-processing/"

