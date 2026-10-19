# Student Management System

Intermediate-level full-stack student management project built with:

- HTML5
- CSS3
- Vanilla JavaScript
- Node.js + Express
- MySQL
- JWT authentication
- bcryptjs password hashing

## Features

- Admin and faculty login
- Role-based route protection
- Dashboard statistics
- Student CRUD
- Attendance tracking
- Marks entry and result calculation
- Student search/filter
- Responsive admin UI
- MySQL relational schema with foreign keys

## Requirements

- Node.js 18+
- MySQL 8+
- A browser

## Setup

1. Create the database:
   - Open MySQL Workbench or the MySQL CLI.
   - Run `database/schema.sql`.
2. Copy `.env.example` to `.env` and update MySQL credentials.
3. Install packages:

   `npm install`

4. Start:

   `npm start`

5. Open:

   `http://localhost:3000`

## Demo accounts

The SQL seed creates:

- Admin: `admin@example.com` / `admin123`
- Faculty: `faculty@example.com` / `faculty123`

Passwords are stored as bcrypt hashes.

## Project structure

- `server.js` - Express server and REST API
- `database/schema.sql` - database, tables, indexes and seed data
- `public/` - frontend
- `middleware/auth.js` - JWT authentication and role checks

This is an educational project and should be hardened further before production use.
