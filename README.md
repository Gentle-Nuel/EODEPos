# EODE POS — Point of Sale & Inventory Management

A production POS and store management application built for **Ebenezer-Online Digital Enterprise (EODE)**, a drinks and spirits retail business in Owerri, Imo State, Nigeria.

The system digitizes daily retail operations across sales, inventory, stock deliveries, receipts, staff access, notifications, and reporting. It supports separate **Admin** and **Attendant** workflows and uses Supabase for authentication, PostgreSQL data management, storage, and server-side functions.

---

## Overview

EODE POS replaces manual sales and inventory recording with a role-based system designed for day-to-day retail operations.

The application is built with **React Native and Expo**, with support for Android and web. The web build is deployed as an installable PWA through Vercel, while the project is also configured for native Android builds through Expo Application Services (EAS).

A key requirement was reliability in a retail environment where internet connectivity may be interrupted. Sales can therefore be recorded locally and synchronized automatically when connectivity is restored.

---

## Tech Stack

| Layer                  | Technology                             |
| ---------------------- | -------------------------------------- |
| Application            | React Native, Expo SDK 56              |
| Web                    | React Native Web, Expo web export      |
| Navigation             | React Navigation                       |
| Backend                | Supabase                               |
| Database               | PostgreSQL                             |
| Authentication         | Supabase Auth                          |
| Server-side operations | Supabase Edge Functions                |
| Storage                | Supabase Storage                       |
| Local persistence      | AsyncStorage                           |
| Connectivity           | NetInfo                                |
| Notifications          | Expo Notifications                     |
| Receipts               | Expo Print, Expo Sharing               |
| Security               | Row-Level Security (RLS), Secure Store |
| Web deployment         | Vercel                                 |
| Native builds          | Expo Application Services (EAS)        |

---

## User Roles

### Admin

Full access to store management and operational oversight.

* Monitor sales performance and low-stock products
* Manage products and inventory
* Review and verify incoming deliveries
* View sales across all attendants
* Manage attendant accounts
* Update store information
* Export sales data
* Receive operational notifications

### Attendant

Focused on day-to-day sales and stock delivery logging.

* Record sales
* Search and select products
* Process single or split payments
* Generate and share receipts
* Log incoming deliveries
* View personal sales history
* Continue recording sales during temporary loss of connectivity

---

## Features

### Authentication & Access Control

* Supabase Auth-based authentication
* Separate Admin and Attendant workflows
* Role-based navigation and access restrictions
* Persistent sessions using AsyncStorage
* Privileged account operations handled server-side through Supabase Edge Functions

### POS / Sales

* Product search and filtering
* Live stock quantities
* Cart-based sales workflow
* Quantity controls
* Cash, Transfer, and POS payment methods
* Split payments using up to two payment methods
* Automatic stock deduction through a PostgreSQL database trigger
* Offline sales queue with automatic synchronization when connectivity returns

### Receipts

Receipts are generated after successful sales and include:

* Receipt number
* Transaction date
* Attendant name
* Itemized products and quantities
* Unit prices and totals
* Payment breakdown
* Current store name, address, tagline, and contact information

Receipts can be printed, shared, or saved as PDF.

### Inventory Management

Admins can:

* Add, edit, and remove products
* Manage selling prices
* Track stock quantities
* Configure low-stock thresholds
* Manage product descriptions and images
* Monitor low-stock conditions from the dashboard

### Delivery Verification

Incoming stock is deliberately separated into two stages:

1. **Attendant logs the delivery**
2. **Admin verifies the delivery**

Inventory is only increased after an administrator approves the delivery. Rejected deliveries remain out of inventory and can include a rejection reason.

This prevents unverified deliveries from silently inflating stock levels.

### Sales History & Reporting

* Attendant-specific sales history
* Full administrative sales history
* End-of-day sales summaries
* Sales breakdown by payment method
* Items sold and transaction totals
* Sales data export for reporting and record-keeping

### Notifications

The system supports operational notifications for:

* Low-stock products
* Delivery status changes

---

## Database Design

The application uses PostgreSQL through Supabase.

| Table            | Purpose                                              |
| ---------------- | ---------------------------------------------------- |
| `profiles`       | User accounts and role information                   |
| `products`       | Product catalogue and inventory quantities           |
| `sales`          | Transaction records and payment information          |
| `sale_items`     | Products and quantities associated with each sale    |
| `deliveries`     | Incoming stock and verification status               |
| `store_settings` | Business information used throughout the application |

### Database Triggers

Important inventory operations are enforced at the database level rather than relying entirely on client-side logic.

* New sales automatically decrement product stock.
* Approved deliveries automatically increment product stock.
* User profiles are created alongside authenticated users.

This keeps critical inventory changes tied to database state rather than making them dependent on a particular client implementation.

---

## Security

Security-sensitive operations are separated from the client application.

* Row-Level Security (RLS) policies protect database access.
* User access is separated by role.
* Administrative operations requiring elevated privileges are handled through Supabase Edge Functions.
* The Supabase service-role key is never exposed to the client.
* Secure Store is included for protected local application data.

The repository contains dedicated Edge Functions for privileged attendant-account operations, including attendant deletion and password management.

---

## Offline Support

Retail transactions cannot always depend on continuous connectivity.

When the device loses internet access, sales can be stored locally using AsyncStorage. NetInfo monitors connectivity and triggers synchronization when the connection becomes available again.

The interface also provides an offline state indicator so the attendant can distinguish between connected and offline operation.

---

## Delivery

The application supports both web and native Android targets.

### Web

The Expo application can be exported for the web and deployed to Vercel as an installable PWA.

### Android

The project includes Expo Android configuration and EAS build profiles, allowing the application to be packaged as a native Android application.

The current client deployment is designed around the business's operational needs rather than requiring distribution through the Google Play Store.

---

## Project Structure

```text
EODEPos/
├── assets/                  # Application and platform assets
├── scripts/                 # Web build utilities
├── src/
│   ├── components/          # Reusable UI components
│   ├── constants/           # Application constants
│   ├── lib/                 # Supabase and supporting utilities
│   ├── navigation/          # Role-based navigation
│   └── screens/             # Application screens
├── supabase/
│   ├── functions/           # Privileged Edge Functions
│   └── migrations/          # Database schema and changes
├── App.js
├── app.json                 # Expo application configuration
├── eas.json                 # EAS build configuration
├── package.json
└── vercel.json              # Web deployment configuration
```

---

## Getting Started

### Prerequisites

* Node.js
* npm
* An Expo development environment
* A Supabase project

### Installation

```bash
git clone https://github.com/Gentle-Nuel/EODEPos.git
cd EODEPos
npm install
```

### Environment Variables

Create the required environment configuration for the Supabase project.

The application requires the Supabase project URL and client/anon key for client-side access.

### Start the Development Server

```bash
npm start
```

### Run on Android

```bash
npm run android
```

### Run on Web

```bash
npm run web
```

### Export the Web Application

```bash
npm run export:web
```

The exported web build can then be deployed through the configured Vercel deployment workflow.

---

## Current Status

**Deployed and in active use by a retail client.**

EODE POS was built for a real retail operation and is designed around its day-to-day sales and inventory workflow. The system continues to be refined as operational requirements evolve.
