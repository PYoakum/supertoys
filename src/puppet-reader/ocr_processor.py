#!/usr/bin/env python3

import sys
import cv2
import pytesseract
import numpy as np
from pathlib import Path

def preprocess_image_opencv(image_path):
    """
    Preprocess image using OpenCV for better OCR results
    """
    # Read the image
    img = cv2.imread(image_path)
    
    if img is None:
        raise ValueError(f"Could not read image: {image_path}")
    
    # Convert to grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Apply denoising
    denoised = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)
    
    # Apply adaptive thresholding
    thresh = cv2.adaptiveThreshold(
        denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2
    )
    
    # Optional: Apply morphological operations to remove noise
    kernel = np.ones((1, 1), np.uint8)
    processed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    
    return processed

def extract_text_from_image(image_path):
    """
    Extract text from image using OpenCV preprocessing and Tesseract OCR
    """
    try:
        # Preprocess with OpenCV
        processed_img = preprocess_image_opencv(image_path)
        
        # Configure Tesseract
        custom_config = r'--oem 3 --psm 6'
        
        # Extract text
        text = pytesseract.image_to_string(processed_img, config=custom_config)
        
        return text.strip()
    
    except Exception as e:
        return f"Error during OCR: {str(e)}"

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 ocr_processor.py <image_path>", file=sys.stderr)
        sys.exit(1)
    
    image_path = sys.argv[1]
    
    if not Path(image_path).exists():
        print(f"Error: Image file not found: {image_path}", file=sys.stderr)
        sys.exit(1)
    
    # Extract text
    extracted_text = extract_text_from_image(image_path)
    
    # Print to stdout (captured by parent process)
    print(extracted_text)

if __name__ == "__main__":
    main()