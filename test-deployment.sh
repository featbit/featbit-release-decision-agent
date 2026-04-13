#!/bin/bash
set -e

echo "🧪 FeatBit Release Decision Agent - Deployment Test Suite"
echo "========================================================="
echo ""

echo "⏳ Testing Web Service (www.featbit.ai)..."
echo "Endpoint: GET /api/projects"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://www.featbit.ai/api/projects)
if [ "$STATUS" = "200" ]; then
  echo "✅ Web Service is responding (HTTP $STATUS)"
  PROJECTS=$(curl -s https://www.featbit.ai/api/projects)
  echo "   Response: $PROJECTS"
else
  echo "❌ Web Service returned HTTP $STATUS"
fi

echo ""
echo "⏳ Testing Experiments Running Endpoint..."
echo "Endpoint: GET /api/experiments/running"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://www.featbit.ai/api/experiments/running)
if [ "$STATUS" = "200" ]; then
  echo "✅ Experiments Running is responding (HTTP $STATUS)"
  RUNNING=$(curl -s https://www.featbit.ai/api/experiments/running)
  echo "   Response: $RUNNING"
else
  echo "❌ Experiments Running returned HTTP $STATUS"
fi

echo ""
echo "⏳ Testing TSDB Service (tsdb.featbit.ai)..."
echo "Endpoint: GET /api/stats"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://tsdb.featbit.ai/api/stats)
if [ "$STATUS" = "200" ]; then
  echo "✅ TSDB Service is responding (HTTP $STATUS)"
  STATS=$(curl -s https://tsdb.featbit.ai/api/stats)
  echo "   Response: $STATS"
else
  echo "❌ TSDB Service returned HTTP $STATUS"
fi

echo ""
echo "========================================================="
echo "Test Suite Complete"
