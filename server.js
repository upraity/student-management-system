require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2/promise");
const path = require("path");
const { requireAuth, requireRole } = require("./middleware/auth");

const app = express();
const PORT = process.env.PORT || 3000;

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "student_management",
  waitForConnections: true,
  connectionLimit: 10
});

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch {
    res.status(500).json({ ok: false, database: "unavailable" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password are required." });

    const [rows] = await pool.query("SELECT id, name, email, password_hash, role FROM users WHERE email = ?", [email]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.cookie("token", token, { httpOnly: true, sameSite: "lax", secure: false, maxAge: 8 * 60 * 60 * 1000 });
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: "Login failed.", error: err.message });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logged out." });
});

app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: req.user }));

app.get("/api/dashboard", requireAuth, async (req, res) => {
  try {
    const [[students]] = await pool.query("SELECT COUNT(*) AS total FROM students");
    const [[courses]] = await pool.query("SELECT COUNT(DISTINCT course) AS total FROM students");
    const [[attendance]] = await pool.query(`
      SELECT COALESCE(ROUND(100 * SUM(status='Present') / NULLIF(COUNT(*),0), 1), 0) AS percentage
      FROM attendance
      WHERE attendance_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    `);
    const [[marks]] = await pool.query(`
      SELECT COALESCE(ROUND(AVG((internal_marks + external_marks) / max_marks * 100), 1), 0) AS average
      FROM marks
    `);
    res.json({
      students: students.total,
      courses: courses.total,
      attendance: attendance.percentage,
      average: marks.average
    });
  } catch (err) {
    res.status(500).json({ message: "Could not load dashboard.", error: err.message });
  }
});

app.get("/api/students", requireAuth, async (req, res) => {
  try {
    const { search = "", course = "", semester = "" } = req.query;
    const terms = [];
    const values = [];
    if (search) {
      terms.push("(roll_no LIKE ? OR name LIKE ? OR email LIKE ?)");
      const s = `%${search}%`;
      values.push(s, s, s);
    }
    if (course) { terms.push("course = ?"); values.push(course); }
    if (semester) { terms.push("semester = ?"); values.push(Number(semester)); }

    const where = terms.length ? `WHERE ${terms.join(" AND ")}` : "";
    const [rows] = await pool.query(`SELECT * FROM students ${where} ORDER BY id DESC`, values);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Could not load students.", error: err.message });
  }
});

app.post("/api/students", requireAuth, requireRole("admin", "faculty"), async (req, res) => {
  try {
    const { roll_no, name, email, phone, course, semester, admission_year, gender, address } = req.body;
    if (!roll_no || !name || !course || !semester || !admission_year) {
      return res.status(400).json({ message: "Roll number, name, course, semester and admission year are required." });
    }
    const [result] = await pool.query(
      `INSERT INTO students (roll_no,name,email,phone,course,semester,admission_year,gender,address)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [roll_no,name,email || null,phone || null,course,semester,admission_year,gender || "Other",address || null]
    );
    const [rows] = await pool.query("SELECT * FROM students WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(400).json({ message: err.code === "ER_DUP_ENTRY" ? "Roll number or email already exists." : err.message });
  }
});

app.put("/api/students/:id", requireAuth, requireRole("admin", "faculty"), async (req, res) => {
  try {
    const { roll_no, name, email, phone, course, semester, admission_year, gender, address } = req.body;
    await pool.query(
      `UPDATE students SET roll_no=?,name=?,email=?,phone=?,course=?,semester=?,admission_year=?,gender=?,address=? WHERE id=?`,
      [roll_no,name,email || null,phone || null,course,semester,admission_year,gender || "Other",address || null,req.params.id]
    );
    const [rows] = await pool.query("SELECT * FROM students WHERE id = ?", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ message: "Student not found." });
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ message: err.code === "ER_DUP_ENTRY" ? "Roll number or email already exists." : err.message });
  }
});

app.delete("/api/students/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM students WHERE id = ?", [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: "Student not found." });
    res.json({ message: "Student deleted." });
  } catch (err) {
    res.status(500).json({ message: "Could not delete student.", error: err.message });
  }
});

app.get("/api/attendance", requireAuth, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0,10);
    const [rows] = await pool.query(`
      SELECT s.id, s.roll_no, s.name, s.course, s.semester,
             COALESCE(a.status, 'Present') AS status
      FROM students s
      LEFT JOIN attendance a ON a.student_id=s.id AND a.attendance_date=?
      ORDER BY s.roll_no
    `, [date]);
    res.json({ date, rows });
  } catch (err) {
    res.status(500).json({ message: "Could not load attendance.", error: err.message });
  }
});

app.post("/api/attendance/bulk", requireAuth, requireRole("admin", "faculty"), async (req, res) => {
  try {
    const { date, records } = req.body;
    if (!date || !Array.isArray(records)) return res.status(400).json({ message: "Date and records are required." });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const record of records) {
        await conn.query(
          `INSERT INTO attendance (student_id, attendance_date, status, marked_by)
           VALUES (?,?,?,?)
           ON DUPLICATE KEY UPDATE status=VALUES(status), marked_by=VALUES(marked_by)`,
          [record.student_id, date, record.status, req.user.id]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback(); throw e;
    } finally { conn.release(); }
    res.json({ message: "Attendance saved successfully." });
  } catch (err) {
    res.status(500).json({ message: "Could not save attendance.", error: err.message });
  }
});

app.get("/api/marks", requireAuth, async (req, res) => {
  try {
    const { student_id = "", semester = "" } = req.query;
    const where = [];
    const values = [];
    if (student_id) { where.push("m.student_id=?"); values.push(student_id); }
    if (semester) { where.push("m.semester=?"); values.push(semester); }
    const [rows] = await pool.query(`
      SELECT m.*, s.roll_no, s.name,
        ROUND((m.internal_marks+m.external_marks)/m.max_marks*100,2) AS percentage
      FROM marks m JOIN students s ON s.id=m.student_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY s.roll_no, m.subject
    `, values);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Could not load marks.", error: err.message });
  }
});

app.post("/api/marks", requireAuth, requireRole("admin", "faculty"), async (req, res) => {
  try {
    const { student_id, subject, internal_marks, external_marks, max_marks, semester } = req.body;
    if (!student_id || !subject || semester === undefined) return res.status(400).json({ message: "Student, subject and semester are required." });
    await pool.query(
      `INSERT INTO marks (student_id,subject,internal_marks,external_marks,max_marks,semester,entered_by)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE internal_marks=VALUES(internal_marks), external_marks=VALUES(external_marks), max_marks=VALUES(max_marks), entered_by=VALUES(entered_by)`,
      [student_id,subject,Number(internal_marks||0),Number(external_marks||0),Number(max_marks||100),Number(semester),req.user.id]
    );
    res.status(201).json({ message: "Marks saved." });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete("/api/marks/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    await pool.query("DELETE FROM marks WHERE id=?", [req.params.id]);
    res.json({ message: "Marks deleted." });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`Student Management System running at http://localhost:${PORT}`));
