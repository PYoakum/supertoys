#!/usr/bin/env python3
"""
rs-mq message queue server test client
"""

import requests
import json
import time
from datetime import datetime

BASE_URL = "http://localhost:8080"

def print_section(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}\n")

def health_check():
    print_section("1. Health Check")
    response = requests.get(f"{BASE_URL}/health")
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")

def enqueue_messages():
    print_section("2. Enqueuing Messages")
    messages = [
        "Hello from Python!",
        "This is message number 2",
        "Testing the message queue",
        "Another message here",
        "Final test message"
    ]
    
    message_ids = []
    for i, msg in enumerate(messages, 1):
        response = requests.post(
            f"{BASE_URL}/enqueue",
            json={"payload": msg}
        )
        data = response.json()
        message_ids.append(data['message_id'])
        print(f"  Message {i}: {data['message_id'][:8]}... - '{msg}'")
    
    return message_ids

def check_status():
    print_section("3. Queue Status")
    response = requests.get(f"{BASE_URL}/status")
    data = response.json()
    print(f"Queue Size: {data['queue_size']}")
    print(f"Status: {data['status']}")

def dequeue_messages(count=3):
    print_section(f"4. Dequeuing {count} Messages")
    for i in range(count):
        response = requests.get(f"{BASE_URL}/dequeue")
        data = response.json()
        
        if data['message']:
            msg = data['message']
            print(f"\n  Dequeued Message {i+1}:")
            print(f"    ID: {msg['id']}")
            print(f"    Payload: {msg['payload']}")
            print(f"    Timestamp: {msg['timestamp']}")
            print(f"    Remaining in queue: {data['queue_size']}")
        else:
            print(f"\n  Dequeue {i+1}: Queue is empty")
            break

def clear_queue():
    print_section("5. Clearing Queue")
    response = requests.post(f"{BASE_URL}/clear")
    data = response.json()
    print(f"Queue cleared: {data['status']}")
    print(f"Queue size now: {data['queue_size']}")

def main():
    print("\n" + "="*60)
    print("  Message Queue Server - Python Test Client")
    print("  Make sure the server is running on localhost:8080")
    print("="*60)
    
    try:
        # Test sequence
        health_check()
        time.sleep(0.5)
        
        enqueue_messages()
        time.sleep(0.5)
        
        check_status()
        time.sleep(0.5)
        
        dequeue_messages(3)
        time.sleep(0.5)
        
        check_status()
        time.sleep(0.5)
        
        clear_queue()
        time.sleep(0.5)
        
        check_status()
        
        print_section("✓ All Tests Completed Successfully!")
        
    except requests.exceptions.ConnectionError:
        print("\n❌ Error: Could not connect to the server.")
        print("Make sure the MQ server is running on localhost:8080")
        print("\nStart it with: ./target/release/rs-mq")
    except Exception as e:
        print(f"\n❌ Error: {e}")

if __name__ == "__main__":
    main()