#!/bin/bash

# Example test script to demonstrate CLI executor capabilities

echo "=== Test Script Start ==="
echo ""
echo "Current Time: $(date)"
echo "Hostname: $(hostname)"
echo "User: $USER"
echo ""
echo "Arguments received: $@"
echo "Number of arguments: $#"
echo ""

# Simulate some work
echo "Processing..."
sleep 1

# Generate some output
echo "File listing of current directory:"
ls -lh

echo ""
echo "=== Test Script Complete ==="

# Return success
exit 0