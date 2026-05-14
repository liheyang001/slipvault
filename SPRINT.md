# Invoice Reader — Product Backlog & Sprint Planning

## Product Vision
> As a user, I want to photograph any invoice or receipt, have it automatically recognized and stored, and be able to find any past purchase quickly by searching merchant, item, date, or price — so I can throw away physical invoices without losing track of what I bought.

---

## Epics

| # | Epic | Priority |
|---|------|----------|
| E1 | Camera & Photo Capture | P0 |
| E2 | Invoice Detection & OCR | P0 |
| E3 | AI Data Extraction | P0 |
| E4 | Local Storage & Data Model | P0 |
| E5 | Search & Filtering | P0 |
| E6 | Invoice Review & Editing | P1 |
| E7 | Organization & Categorization | P1 |
| E8 | Analytics & Reporting | P2 |
| E9 | Cloud Backup & Sync | P2 |

---

## Sprint 1 — Foundation & Camera
**Goal**: User can open the app, take a photo, and see it saved locally.
**Status**: `[ ] Not Started`

### User Stories

| ID | Story | Acceptance Criteria | Status |
|----|-------|---------------------|--------|
| US-01 | As a user, I want to open the app and immediately see a camera viewfinder so I can take a photo quickly. | App launches directly to camera view; < 1s load time | `[ ]` |
| US-02 | As a user, I want to tap a button to capture a photo of an invoice. | Photo is captured, preview is shown; user can confirm or retake | `[ ]` |
| US-03 | As a user, I want the app to tell me if my photo is too blurry before saving it. | Blur detection triggers a warning prompt if quality < threshold | `[ ]` |
| US-04 | As a user, I want to import a photo from my camera roll instead of taking a new one. | Gallery picker is accessible from the main screen | `[ ]` |
| US-05 | As a developer, I want a local database initialized on first launch so invoices can be stored. | SQLite/Realm schema created; migrations supported | `[ ]` |

---

## Sprint 2 — Invoice Detection & OCR
**Goal**: App can detect if a photo is an invoice and extract raw text from it.
**Status**: `[ ] Not Started`

### User Stories

| ID | Story | Acceptance Criteria | Status |
|----|-------|---------------------|--------|
| US-06 | As a user, I want the app to automatically detect if my photo contains an invoice so I don't have to manually classify it. | Detection accuracy > 90%; non-invoices are flagged with a prompt | `[ ]` |
| US-07 | As a user, I want the app to reject clearly non-invoice photos (e.g. a selfie) and show me a friendly message. | Non-invoice photos show "This doesn't look like an invoice" with option to save anyway | `[ ]` |
| US-08 | As a developer, I want OCR to extract all text from an invoice image so downstream LLM can parse it. | Raw OCR text is extracted and stored; supports English and Chinese | `[ ]` |
| US-09 | As a user, I want the app to auto-rotate my invoice photo if it's sideways. | Image rotation is corrected before OCR processing | `[ ]` |

---

## Sprint 3 — AI Data Extraction (Claude API)
**Goal**: App uses Claude API to turn raw OCR text into structured invoice data.
**Status**: `[ ] Not Started`

### User Stories

| ID | Story | Acceptance Criteria | Status |
|----|-------|---------------------|--------|
| US-10 | As a user, I want the app to automatically extract the merchant name from my invoice. | Vendor field populated correctly for > 85% of test invoices | `[ ]` |
| US-11 | As a user, I want the invoice date to be extracted automatically so I don't need to type it. | Date field populated in ISO format; handles various date formats | `[ ]` |
| US-12 | As a user, I want all purchased items to be extracted as a list with name, quantity, and price. | Line items array correctly parsed; totals match | `[ ]` |
| US-13 | As a user, I want the total amount extracted so I can quickly see how much I spent. | Total field extracted; cross-validated against line items when possible | `[ ]` |
| US-14 | As a developer, I want LLM extraction to use prompt caching so repeated calls are cheaper and faster. | Claude API calls use cache-control headers; cache hit rate > 60% | `[ ]` |
| US-15 | As a user, I want the extraction to complete within 5 seconds of confirming my photo. | End-to-end pipeline (OCR + LLM) runs in < 5s on device | `[ ]` |

---

## Sprint 4 — Invoice List & Detail View
**Goal**: User can see a list of all saved invoices and view the details of each one.
**Status**: `[ ] Not Started`

### User Stories

| ID | Story | Acceptance Criteria | Status |
|----|-------|---------------------|--------|
| US-16 | As a user, I want to see a list of all my saved invoices sorted by date so I can browse them. | List view shows thumbnail, merchant, date, total; sorted newest first | `[ ]` |
| US-17 | As a user, I want to tap an invoice to see its full details including the original photo. | Detail view shows photo, all extracted fields, and line items | `[ ]` |
| US-18 | As a user, I want to delete an invoice I no longer need. | Swipe-to-delete or delete button removes record and image file | `[ ]` |
| US-19 | As a user, I want the app to show a summary total (e.g. "23 invoices, $1,240 total") on my list screen. | Summary bar visible at bottom of list view | `[ ]` |

---

## Sprint 5 — Search & Filtering
**Goal**: User can find any invoice by merchant, date, price, or item name.
**Status**: `[ ] Not Started`

### User Stories

| ID | Story | Acceptance Criteria | Status |
|----|-------|---------------------|--------|
| US-20 | As a user, I want to search by merchant name so I can find all invoices from a specific store. | Search returns results within 1s; fuzzy matching supported | `[ ]` |
| US-21 | As a user, I want to search by item name (e.g. "bread machine") and find the invoice I bought it on. | Full-text search covers item descriptions; returns correct invoice | `[ ]` |
| US-22 | As a user, I want to filter invoices by a date range (e.g. last 3 months) to review period spending. | Date picker filter updates list in real-time | `[ ]` |
| US-23 | As a user, I want to filter invoices by price range so I can find large purchases. | Min/Max price filter returns correctly scoped results | `[ ]` |
| US-24 | As a user, I want to combine multiple filters (e.g. "electronics in 2024 > $200") in one search. | Multiple active filters stack correctly; clear-all button available | `[ ]` |

---

## Sprint 6 — Review & Editing
**Goal**: User can correct any wrongly extracted data.
**Status**: `[ ] Not Started`

### User Stories

| ID | Story | Acceptance Criteria | Status |
|----|-------|---------------------|--------|
| US-25 | As a user, I want to edit the merchant name if the AI got it wrong. | All fields editable inline; changes saved immediately | `[ ]` |
| US-26 | As a user, I want to add or remove line items manually if some were missed. | Item list has add/delete row functionality | `[ ]` |
| US-27 | As a user, I want to re-run AI extraction on a saved invoice if the first attempt was poor. | "Re-analyze" button re-runs OCR + LLM pipeline on saved image | `[ ]` |

---

## Sprint 7 — Organization & Categories
**Goal**: User can organize invoices with categories and tags.
**Status**: `[ ] Not Started`

### User Stories

| ID | Story | Acceptance Criteria | Status |
|----|-------|---------------------|--------|
| US-28 | As a user, I want invoices to be auto-categorized (e.g. groceries, electronics) so I don't have to label them manually. | Auto-category assigned based on merchant name; > 75% accuracy | `[ ]` |
| US-29 | As a user, I want to add custom tags to an invoice (e.g. "warranty", "business expense"). | Tag input available on detail view; tags searchable | `[ ]` |
| US-30 | As a user, I want to filter my invoice list by category. | Category filter pill on list view | `[ ]` |

---

## Future Backlog (No Sprint Assigned)

| ID | Story | Epic |
|----|-------|------|
| US-31 | As a user, I want to see a monthly spending chart broken down by category. | E8 |
| US-32 | As a user, I want to export my invoices to a CSV file for expense reporting. | E8 |
| US-33 | As a user, I want to back up my invoices to iCloud/Google Drive. | E9 |
| US-34 | As a user, I want to access my invoices on a second device after signing in. | E9 |
| US-35 | As a user, I want to share an invoice detail view as a PDF. | E8 |

---

## Definition of Done

An item is **Done** when:
- [ ] Feature is implemented and works on both iOS and Android (or target platform)
- [ ] Unit tests cover core logic
- [ ] No crashes on happy path and common edge cases
- [ ] UI reviewed by at least one person
- [ ] Acceptance criteria from the user story are met

---

## Progress Tracker

| Sprint | Stories | Done | In Progress | Not Started |
|--------|---------|------|-------------|-------------|
| Sprint 1 | 5 | 0 | 0 | 5 |
| Sprint 2 | 4 | 0 | 0 | 4 |
| Sprint 3 | 6 | 0 | 0 | 6 |
| Sprint 4 | 4 | 0 | 0 | 4 |
| Sprint 5 | 5 | 0 | 0 | 5 |
| Sprint 6 | 3 | 0 | 0 | 3 |
| Sprint 7 | 3 | 0 | 0 | 3 |
| **Total** | **30** | **0** | **0** | **30** |
