# EODE POS — Point of Sale & Inventory Management App

A full-featured Progressive Web App (PWA) built for **Ebenezer-Online Digital Enterprise (EODE)**, a drinks and spirits retail business in Owerri, Imo State, Nigeria. The app streamlines daily shop operations: sales recording, inventory control, delivery verification, and reporting, across two user roles with a real-time Supabase backend.

---

## Overview

EODE POS is a role-based shop management system built with React Native (Expo) targeting Android via PWA. It replaces manual sales recording with a fast, reliable digital workflow that works on any Android device through a browser link, no Play Store installation required.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React Native (Expo SDK 56), web export |
| Backend | Supabase (PostgreSQL + Auth + Storage + Edge Functions) |
| Hosting | Vercel (PWA via `dist/` folder) |
| Offline | AsyncStorage queue + NetInfo sync |
| Auth | Supabase Auth with role-based access |

---

## User Roles

### Admin
Full access to all management features.

### Attendant
Restricted to sales, delivery logging, and their own history.

---

## Features

### Authentication
- Single login screen with role toggle (Admin / Attendant)
- Supabase Auth with session persistence via AsyncStorage
- Role-based navigation: each role sees only their permitted screens

---

### Attendant Features

#### POS / New Sale
- Alphabetical product list with live stock quantities
- Search/filter products by name
- Add to cart with quantity controls
- Single or split payment support (Cash, Transfer, POS terminal, up to 2 methods per sale)
- Dynamic split payment inputs, shown only when two methods are selected
- Automatic stock deduction on sale via database trigger, no app-side logic required
- Offline mode: sales saved locally to device when no internet, auto-synced on reconnect via NetInfo
- Offline banner indicator when connection is lost

#### Receipt
- Auto-generated after every successful sale
- Pulls live store name, address, and tagline from the database (no hardcoded values)
- Shows itemized list, quantities, unit prices, totals, and payment breakdown
- Receipt number, date, and serving attendant name
- Actions: Print, Share, Save as PDF

#### Log Delivery
- Attendant logs incoming stock: product, quantity received, and notes
- Delivery enters a pending state and does not update inventory until admin verifies
- Prevents ghost stock updates from unverified deliveries

#### Sales History
- Attendant's own sales records
- Date and amount per transaction

---

### Admin Features

#### Dashboard
- At-a-glance overview of sales performance
- Low stock alerts: products below admin-set threshold surface automatically
- Notifications panel

#### Inventory Management
- Full product list with stock levels and low stock indicators
- Add / Edit / Delete products
- Fields: name, price, stock quantity, low stock threshold, unit description, product image

#### Delivery Verification
- View all pending deliveries logged by attendants
- Approve: triggers automatic stock increment via database trigger
- Reject with a rejection reason: attendant is notified
- Prevents inventory from being inflated by unverified stock

#### Sales History + End-of-Day Summary
- Full sales log across all attendants
- End-of-day summary view: total sales, breakdown by payment method, items sold

#### Manage Attendants
- Create new attendant accounts (handled via Supabase Edge Function, service role key never exposed to client)
- View and manage existing attendant accounts

#### Store Details
- Edit business name, tagline, address, and contact info
- Changes reflected live on all receipts

#### Export Data
- Export sales data for reporting and record-keeping

#### Notifications
- Low stock alerts per product
- Delivery status updates

---

## Database Schema

| Table | Purpose |
|---|---|
| `profiles` | User accounts linked to Supabase Auth (role: admin / attendant) |
| `products` | Inventory: name, price, stock, threshold, image |
| `sales` | Sale records: attendant, total, payment methods and amounts |
| `sale_items` | Line items per sale: product, quantity, unit price at time of sale |
| `deliveries` | Delivery logs with pending / approved / rejected workflow |
| `store_settings` | Single-row business info pulled by receipts |

### Database Triggers
- **Profile creation:** auto-created when a user signs up
- **Stock decrement:** fires on new sale, reduces product stock automatically
- **Stock increment:** fires only when a delivery moves from pending to approved

---

## Security Notes

- `SUPABASE_URL` and `SUPABASE_ANON_KEY` are the public/anon credentials for this project
- They are intentionally committed: the anon key is safe to expose in client-side apps
- Data is protected by Row Level Security (RLS) policies on all tables
- Admin operations requiring elevated permissions are routed through a Supabase Edge Function: the service role key never exists in the client bundle

---

## Delivery

- Delivered as a PWA via a browser link, no Play Store submission required
- Installable on Android (Add to Home Screen)
- Hosted on Vercel