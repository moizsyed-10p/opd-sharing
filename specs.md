# 📄 OPD Sharing & Reimbursement Management System

## 🧠 Overview

This project is a lightweight internal tool designed to simplify and standardize the process of managing OPD (Outpatient Department) reimbursement slips within small teams.

In many organizations, employees receive a fixed monthly OPD reimbursement limit. In practice, individuals often struggle to fully utilize their allowance and resort to manually sharing or borrowing OPD slips from colleagues. This process is typically unstructured, inefficient, and prone to confusion.

This application transforms that informal process into a structured, transparent, and automated system.

---

## 🎯 Problem Statement

- OPD slips are scattered across individuals  
- Manual sharing via chat/email is messy  
- No tracking of who used which slip  
- Risk of duplicate usage  
- Time wasted arranging and combining documents  

---

## 💡 Solution

The system provides a centralized platform where users within a group can:

- Upload OPD slips (PDFs or images)
- Automatically split multi-page documents into individual OPDs
- Share access to all group members
- Track usage per user to prevent duplication
- Download OPDs in a controlled and fair manner

---

## ⚙️ Core Features (MVP)

- 🔐 Social authentication (Google / Microsoft)
- 👥 Group-based sharing system
- 📤 Bulk upload of OPD documents
- 📄 Automatic PDF page splitting
- 📊 Per-user OPD usage tracking
- ⬇️ Controlled download with one-time usage
- 🗑️ Auto-cleanup when all users have consumed a slip

---

## 🚀 Planned Enhancements

- 💰 Automatic amount extraction using OCR  
- 🎯 Smart selection of OPDs based on target reimbursement amount  
- 📎 Merge multiple OPDs into a single submission-ready PDF  
- ⚖️ Fair usage controls and quotas  
- 📜 Audit logs for transparency  

---

## 🏗️ Architecture

- Frontend + Backend: Next.js  
- Hosting: Vercel  
- Database & Storage: Supabase  
- Authentication: OAuth (Google / Microsoft)

---

## 🏗️ Tech Stack Constraints

- Framework: Next.js 15+ (App Router)
- Language: TypeScript
- Auth: Supabase Auth (Google/Microsoft)
- Database: Supabase (Postgres)
- Storage: Supabase Buckets
- PDF Logic: pdf-lib (for splitting/merging)
- OCR: Tesseract.js

---

## 🧩 Data Schema (Recommended)

### 👤 profiles
id: uuid (pk)  
email: string (unique)  
full_name: string  
created_at: timestamp  

---

### 👥 groups
id: uuid (pk)  
name: string  
invite_code: string (unique)  
created_at: timestamp  

---

### 🔗 group_members
id: uuid (pk)  
user_id: uuid (fk → profiles.id)  
group_id: uuid (fk → groups.id)  
joined_at: timestamp  

UNIQUE(user_id, group_id)

---

### 📁 opd_files
id: uuid (pk)  
uploader_id: uuid  
group_id: uuid  
original_file_url: string  
created_at: timestamp  

---

### 📄 opd_slips
id: uuid (pk)  
file_id: uuid  
file_url: string  
amount: decimal (default 0)  
created_at: timestamp  

---

### 📊 user_opd_usage
user_id: uuid  
opd_id: uuid  
downloaded_at: timestamp  

PRIMARY KEY (user_id, opd_id)

---

## 📊 ER Diagram

+-------------+        +----------------+        +-------------+
|  profiles   |        | group_members  |        |   groups    |
+-------------+        +----------------+        +-------------+
| id (PK)     |<------>| user_id (FK)   |        | id (PK)     |
| email       |        | group_id (FK)  |<------>| name        |
| full_name   |        | joined_at      |        | invite_code |
| created_at  |        +----------------+        | created_at  |
+-------------+                                   +-------------+

        |
        | uploader_id
        v

+-------------+        +-------------+        +------------------+
| opd_files   |        | opd_slips   |        | user_opd_usage   |
+-------------+        +-------------+        +------------------+
| id (PK)     |------->| file_id FK  |        | user_id (FK)     |
| uploader_id |        | id (PK)     |<------>| opd_id (FK)      |
| group_id FK |        | file_url    |        | downloaded_at    |
| file_url    |        | amount      |        +------------------+
| created_at  |        | created_at  |
+-------------+        +-------------+

---

## 🧩 Base API Structure

/api
  /auth
  /groups
  /files
  /opd
  /usage

---

## 🔐 AUTH

### GET /api/auth/me
Get current logged-in user

Response:
{
  "id": "uuid",
  "email": "user@email.com",
  "full_name": "Moiz"
}

---

## 👥 GROUPS

### POST /api/groups
Create group

Request:
{
  "name": "Dev Team"
}

Response:
{
  "id": "uuid",
  "invite_code": "ABC123"
}

---

### POST /api/groups/join
Join group

Request:
{
  "invite_code": "ABC123"
}

---

### GET /api/groups
List user groups

---

### GET /api/groups/:groupId
Get group details

---

## 📤 FILES

### POST /api/files/upload
Upload OPD file (multipart/form-data)

Response:
{
  "file_id": "uuid",
  "original_file_url": "..."
}

---

### POST /api/files/:fileId/split
Split PDF into OPDs

Response:
{
  "opd_slips": [
    {
      "id": "uuid",
      "file_url": "...",
      "amount": 0
    }
  ]
}

---

## 📄 OPD

### GET /api/opd?groupId=
List OPDs

Response:
[
  {
    "id": "uuid",
    "file_url": "...",
    "amount": 1200,
    "used_count": 3,
    "total_users": 10,
    "is_used_by_me": false
  }
]

---

### GET /api/opd/:id
Get OPD detail

---

### PATCH /api/opd/:id
Update OPD amount

Request:
{
  "amount": 2500
}

---

## ⬇️ DOWNLOAD

### POST /api/opd/:id/download
Download OPD + mark usage

Response:
{
  "download_url": "signed-url"
}

Rules:
- Cannot download twice
- Usage must be recorded
- Must return secure signed URL

---

## 📊 USAGE

### GET /api/usage/me
Get my usage history

Response:
[
  {
    "opd_id": "uuid",
    "downloaded_at": "timestamp",
    "amount": 1200
  }
]

---

## 🎯 SMART MATCH (MVP 2)

### POST /api/opd/match
Request:
{
  "target_amount": 30000,
  "group_id": "uuid"
}

Response:
{
  "selected_opds": [...],
  "total": 29850,
  "difference": 150
}

---

## 📎 MERGE (MVP 2)

### POST /api/opd/merge

Request:
{
  "opd_ids": ["id1", "id2"]
}

Response:
{
  "merged_file_url": "..."
}

---

## ⚠️ Critical Logic

Download must be atomic:

BEGIN;
Check if already used
Insert usage
COMMIT;

---

## 📁 Suggested Next.js Structure

/app/api
  /auth/me/route.ts
  /groups/route.ts
  /groups/join/route.ts
  /files/upload/route.ts
  /files/[id]/split/route.ts
  /opd/route.ts
  /opd/[id]/route.ts
  /opd/[id]/download/route.ts
  /opd/match/route.ts
  /opd/merge/route.ts

---

## ⚠️ Disclaimer

This tool is intended for internal productivity and organization. Users are responsible for ensuring compliance with their company’s reimbursement policies.
