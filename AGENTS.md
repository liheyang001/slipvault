# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Language

Always communicate with the user in **Simplified Chinese (简体中文)**. All responses, explanations, and comments should be in Chinese.

## Project Overview

**Invoice Reader** is a mobile application that uses computer vision and AI to automatically extract and organize invoice information from photos. Users can photograph invoices, and the app automatically recognizes, extracts, and stores the data locally. This allows users to discard physical invoices while maintaining a searchable digital archive.

### Core Features
- **Invoice Photo Recognition**: Automatically detect and validate if a photo contains an invoice
- **Data Extraction**: Extract key information (vendor, date, items, amounts, total)
- **Local Storage**: Persist invoice metadata and images securely on device
- **Advanced Search**: Find invoices by merchant name, time period, price range, or item name
- **Offline First**: All processing and storage happens on the device

## Architecture Overview

### Mobile App Layer
- **Frontend**: Native iOS/Android implementation (TBD - React Native/Flutter/Native)
- **Camera Module**: Photo capture and validation
- **Local Database**: SQLite/Realm for invoice metadata and image references

### AI/Processing Layer
- **OCR Engine**: Extract text from invoice images (Tesseract or cloud-based)
- **LLM Integration**: Use Codex API to structure raw OCR data into structured fields
- **Image Processing**: Handle rotation, quality, and preprocessing

### Search & Query Layer
- **Full-Text Search**: Index vendor names and item descriptions
- **Filtering**: Support date range, price range, category filters
- **Metadata Indexing**: Enable fast queries across stored invoices

## Development Setup

### Prerequisites
- [TBD - specify node version, SDK requirements, etc.]
- [TBD - platform-specific tools]

### Commands
- **Build**: `[TBD]`
- **Run on device/simulator**: `[TBD]`
- **Run tests**: `[TBD]`
- **Lint**: `[TBD]`
- **OCR/LLM integration test**: `[TBD]`

## Key Files & Modules
- TBD: Define main entry points, core modules once codebase exists

## Data Model

Invoices are structured with:
```
{
  id: UUID,
  photoPath: string,        // Local file reference
  ocrText: string,          // Raw OCR output
  vendor: string,           // Extracted from LLM
  date: Date,               // Extracted from LLM
  items: [{name, quantity, price}],
  total: decimal,
  category: string,         // Optional user-assigned
  createdAt: Date,
  updatedAt: Date
}
```

## Important Notes

- **Privacy First**: All invoice processing must happen locally; no data should be sent to servers without explicit user consent
- **LLM Usage**: Leverage Codex API with system prompts to reliably extract structured data from unstructured invoice text
- **Offline Capability**: Design the app to work without internet; optional cloud sync later
- **Image Storage**: Compress and optimize images to minimize storage footprint

## Future Enhancements
- Cloud backup & sync
- Multi-device support
- Receipt vs. Invoice classification
- Expense categorization & reporting
