
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const useSsl = String(process.env.DB_SSL || '').toLowerCase() === 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

app.set('trust proxy', 1);
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'haiconcuu-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 12,
  },
}));

const publicDir = path.join(__dirname, 'public');
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));
app.use(express.static(publicDir));

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (!allowed.includes(file.mimetype)) return cb(new Error('Chỉ cho phép ảnh JPG, PNG hoặc WEBP.'));
    cb(null, true);
  },
});

const leaveUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '');
      const base = path.basename(file.originalname || 'file', ext).replace(/[^\w\-]/g, '_');
      cb(null, `${Date.now()}-${base}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowed = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png'];
    if (!allowed.includes(ext)) return cb(new Error('Định dạng file không được hỗ trợ'));
    cb(null, true);
  }
});

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!['.xlsx', '.xls'].includes(ext)) return cb(new Error('Chỉ cho phép file Excel .xlsx hoặc .xls'));
    cb(null, true);
  }
});

const ROLE_VALUES = ['ADMIN', 'DEPARTMENT_HEAD', 'DEPUTY_MANAGER', 'EMPLOYEE'];
const ACCOUNT_TYPE_VALUES = ['QUAN_LY', 'NGUOI_TUYEN'];
const ROLE_LEVEL = { EMPLOYEE: 1, DEPUTY_MANAGER: 2, DEPARTMENT_HEAD: 3, ADMIN: 4 };

function asyncHandler(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }
function normalizeDigits(value) { return String(value || '').replace(/\D/g, ''); }
function parseDecimal(value, defaultValue = 0) {
  const normalized = String(value ?? '').trim().replace(/,/g, '.');
  if (!normalized) return defaultValue;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : defaultValue;
}
function toFixedNumber(value, digits = 3) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? Number(num.toFixed(digits)) : 0;
}
function isValidDateInput(value) {
  if (!value) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}
function safeLower(v) { return String(v || '').trim().toLowerCase(); }
function safeUpper(v) { return String(v || '').trim().toUpperCase(); }
function pad2(v) { return String(v).padStart(2, '0'); }
function buildTimeValue(hour, minute) {
  if (hour === null || hour === undefined || minute === null || minute === undefined) return null;
  if (hour === '' || minute === '') return null;
  const h = Number(hour), m = Number(minute);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return `${pad2(h)}:${pad2(m)}`;
}
function timePartsFromValue(timeValue) {
  const raw = String(timeValue || '').trim();
  if (!raw) return { hour: null, minute: null, time: null };
  const [h, m] = raw.split(':');
  const hour = Number(h), minute = Number(m);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return { hour: null, minute: null, time: null };
  return { hour, minute, time: `${pad2(hour)}:${pad2(minute)}` };
}
function normalizeLegacyRole(role) {
  const r = safeLower(role);
  if (!r) return 'EMPLOYEE';
  if (r === 'admin') return 'ADMIN';
  if (['department_head', 'truong_phong', 'trưởng phòng', 'truong phong', 'head'].includes(r)) return 'DEPARTMENT_HEAD';
  if (['deputy_manager', 'pho_phong', 'phó phòng', 'pho phong', 'manager', 'company_manager'].includes(r)) return 'DEPUTY_MANAGER';
  if (['employee', 'nhan_vien', 'nhân viên', 'nhan vien', 'user', 'recruiter'].includes(r)) return 'EMPLOYEE';
  return String(role || '').trim().toUpperCase();
}
function normalizeRole(role) {
  const r = normalizeLegacyRole(role);
  return ROLE_VALUES.includes(r) ? r : 'EMPLOYEE';
}
function normalizeLegacyAccountType(currentRole, currentAccountType) {
  const t = safeLower(currentAccountType);
  if (['quan_ly', 'quan ly', 'quản lý', 'manager', 'company_manager'].includes(t)) return 'QUAN_LY';
  if (['nguoi_tuyen', 'nguoi tuyen', 'người tuyển', 'recruiter'].includes(t)) return 'NGUOI_TUYEN';
  const r = safeLower(currentRole);
  if (['admin', 'department_head', 'deputy_manager', 'truong_phong', 'pho_phong'].includes(r)) return 'QUAN_LY';
  return 'NGUOI_TUYEN';
}
function normalizeAccountType(type, role = null) {
  const t = safeUpper(normalizeLegacyAccountType(role, type));
  return ACCOUNT_TYPE_VALUES.includes(t) ? t : 'NGUOI_TUYEN';
}
function roleLabel(role) {
  return { ADMIN: 'Admin', DEPARTMENT_HEAD: 'Trưởng phòng', DEPUTY_MANAGER: 'Phó phòng', EMPLOYEE: 'Nhân viên' }[normalizeRole(role)] || role || '';
}
function accountTypeLabel(type, role = null) {
  return { QUAN_LY: 'Quản lý đơn', NGUOI_TUYEN: 'Người tuyển' }[normalizeAccountType(type, role)] || type || '';
}
function labelStatus(status) { return { PENDING: 'Chờ xử lý', PASSED: 'Đỗ', FAILED: 'Trượt' }[status] || status || ''; }
function labelShift(shift) { return { MORNING: 'Ca sáng', AFTERNOON: 'Ca chiều' }[shift] || shift || ''; }
function labelGender(gender) { return { MALE: 'Nam', FEMALE: 'Nữ' }[gender] || gender || ''; }
function isAdmin(user) { return normalizeRole(user?.role) === 'ADMIN'; }
function canManageInterviews(user) { return isAdmin(user) || normalizeAccountType(user?.account_type, user?.role) === 'QUAN_LY'; }
function canViewDepartment(user) {
  const role = normalizeRole(user?.role);
  const ownDept = String(user?.department_name || user?.department || '').trim();
  const managed = Array.isArray(user?.managed_department_names) ? user.managed_department_names.filter(Boolean) : [];
  return ['DEPARTMENT_HEAD', 'DEPUTY_MANAGER'].includes(role) && !!(ownDept || managed.length);
}
function canApproveLeaves(user) { return ['DEPUTY_MANAGER', 'DEPARTMENT_HEAD', 'ADMIN'].includes(normalizeRole(user?.role)); }
function getRoleLevel(role) { return ROLE_LEVEL[normalizeRole(role)] || 0; }
function getDepartmentName(user) { return String(user?.department_name || user?.department || '').trim(); }
function getManagedDepartmentNames(user) {
  const set = new Set();
  const own = getDepartmentName(user);
  if (own) set.add(own);
  if (Array.isArray(user?.managed_department_names)) {
    user.managed_department_names.map((v) => String(v || '').trim()).filter(Boolean).forEach((v) => set.add(v));
  }
  return Array.from(set);
}
async function queryOne(db, sql, params = []) { const r = await db.query(sql, params); return r.rows[0] || null; }
function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    full_name: row.full_name,
    role: normalizeRole(row.role),
    role_label: roleLabel(row.role),
    account_type: normalizeAccountType(row.account_type, row.role),
    account_type_label: accountTypeLabel(row.account_type, row.role),
    department_id: row.department_id || null,
    department_name: row.department_name || row.department || '',
    department: row.department_name || row.department || '',
    employment_start_date: row.employment_start_date,
    annual_leave_manual_adjustment: toFixedNumber(row.annual_leave_manual_adjustment || 0),
    is_active: row.is_active !== false,
    company_ids: row.company_ids || [],
    company_names: row.company_names || [],
    managed_department_ids: row.managed_department_ids || [],
    managed_department_names: row.managed_department_names || [],
    created_at: row.created_at,
  };
}
function mapInterview(row) {
  if (!row) return null;
  return {
    id: row.id,
    interview_date: row.interview_date,
    interview_shift: row.interview_shift,
    interview_shift_label: labelShift(row.interview_shift),
    company_id: row.company_id,
    company_name: row.company_name,
    recruiter_id: row.recruiter_id,
    recruiter_name: row.recruiter_name,
    recruiter_role: normalizeRole(row.recruiter_role),
    recruiter_role_label: roleLabel(row.recruiter_role),
    recruiter_department: row.recruiter_department,
    full_name: row.full_name,
    gender: row.gender,
    gender_label: labelGender(row.gender),
    cccd_number: row.cccd_number,
    birth_date: row.birth_date,
    permanent_address: row.permanent_address,
    cccd_issue_date: row.cccd_issue_date,
    cccd_expiry_date: row.cccd_expiry_date,
    phone: row.phone,
    status: row.status,
    status_label: labelStatus(row.status),
    result_note: row.result_note,
    result_updated_at: row.result_updated_at,
    result_updated_by_name: row.result_updated_by_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    front_image_url: `/api/interviews/${row.id}/image/front`,
    back_image_url: `/api/interviews/${row.id}/image/back`,
  };
}
function mapLeaveRow(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    requester_name: row.requester_name,
    requester_username: row.requester_username,
    requester_role: normalizeRole(row.requester_role || row.requester_role_current),
    requester_role_label: roleLabel(row.requester_role || row.requester_role_current),
    department_name: row.department_name,
    approver_id: row.approver_id,
    approver_name: row.approver_name,
    approver_role: normalizeRole(row.approver_role_name || row.approver_role),
    approver_role_label: roleLabel(row.approver_role_name || row.approver_role),
    leave_type: row.leave_type,
    reason: row.reason,
    from_date: row.from_date,
    to_date: row.to_date,
    from_time: row.start_time || buildTimeValue(row.start_hour, row.start_minute),
    to_time: row.end_time || buildTimeValue(row.end_hour, row.end_minute),
    annual_leave_days_used: toFixedNumber(row.annual_leave_days_used || 0),
    file_name: row.file_name,
    file_path: row.file_path,
    status: row.status,
    approved_at: row.approved_at,
    rejected_at: row.rejected_at,
    reject_reason: row.reject_reason,
    decision_note: row.reject_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function enrichUsers(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const access = await pool.query(
    `SELECT uca.user_id, c.id, c.name
     FROM user_company_access uca
     INNER JOIN companies c ON c.id = uca.company_id
     WHERE uca.user_id = ANY($1::int[])
     ORDER BY c.name`,
    [ids]
  );
  const deptAccess = await pool.query(
    `SELECT uda.user_id, d.id, d.name
     FROM user_department_access uda
     INNER JOIN departments d ON d.id = uda.department_id
     WHERE uda.user_id = ANY($1::int[])
     ORDER BY d.name`,
    [ids]
  );
  const byUser = new Map();
  access.rows.forEach((row) => {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id).push({ id: Number(row.id), name: row.name });
  });
  const deptByUser = new Map();
  deptAccess.rows.forEach((row) => {
    if (!deptByUser.has(row.user_id)) deptByUser.set(row.user_id, []);
    deptByUser.get(row.user_id).push({ id: Number(row.id), name: row.name });
  });
  return rows.map((row) => ({
    ...row,
    company_ids: (byUser.get(row.id) || []).map((item) => item.id),
    company_names: (byUser.get(row.id) || []).map((item) => item.name),
    managed_department_ids: (deptByUser.get(row.id) || []).map((item) => item.id),
    managed_department_names: (deptByUser.get(row.id) || []).map((item) => item.name),
  }));
}
async function getCurrentUser(userId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.email, u.full_name, u.role, u.account_type,
            u.department_id, u.department, COALESCE(d.name, u.department) AS department_name,
            u.is_active, u.created_at, u.employment_start_date, u.annual_leave_manual_adjustment
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.id = $1 LIMIT 1`,
    [userId]
  );
  const enriched = await enrichUsers(rows);
  return mapUser(enriched[0] || null);
}
async function getUserById(id) {
  return queryOne(pool,
    `SELECT u.*, COALESCE(d.name, u.department) AS department_name
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.id = $1`, [id]);
}
async function getUserByLogin(login) {
  return queryOne(pool,
    `SELECT u.*, COALESCE(d.name, u.department) AS department_name
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE LOWER(COALESCE(u.username, '')) = LOWER($1)
        OR LOWER(COALESCE(u.email, '')) = LOWER($1)
     LIMIT 1`, [login]);
}
async function addInterviewLog({ formId, action, oldStatus = null, newStatus = null, note = null, userId = null }) {
  await pool.query(
    `INSERT INTO interview_logs (form_id, action, old_status, new_status, note, user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [formId, action, oldStatus, newStatus, note, userId]
  );
}
function setSessionUser(req, user) {
  req.session.user = {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: normalizeRole(user.role),
    account_type: normalizeAccountType(user.account_type, user.role),
    department_id: user.department_id || null,
    department_name: user.department_name || user.department || '',
    department: user.department_name || user.department || '',
    company_ids: user.company_ids || [],
    managed_department_ids: user.managed_department_ids || [],
    managed_department_names: user.managed_department_names || [],
  };
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Bạn chưa đăng nhập.' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Bạn chưa đăng nhập.' });
  if (!isAdmin(req.session.user)) return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này.' });
  next();
}
function requireManagePermission(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Bạn chưa đăng nhập.' });
  if (!canManageInterviews(req.session.user)) return res.status(403).json({ error: 'Bạn không có quyền quản lý hồ sơ.' });
  next();
}
function requireApprover(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Bạn chưa đăng nhập.' });
  if (!canApproveLeaves(req.session.user)) return res.status(403).json({ error: 'Bạn không có quyền duyệt đơn.' });
  next();
}

async function syncDepartmentFields(client, userId, departmentId, departmentName) {
  let finalName = String(departmentName || '').trim();
  let finalId = departmentId ? Number(departmentId) : null;
  if (finalId) {
    const dept = await queryOne(client, 'SELECT id, name FROM departments WHERE id = $1', [finalId]);
    if (dept) finalName = dept.name;
  }
  if (!finalId && finalName) {
    let inserted;
    try {
      inserted = await client.query(`INSERT INTO departments(name) VALUES ($1) RETURNING id, name`, [finalName]);
    } catch (e) {
      inserted = await client.query('SELECT id, name FROM departments WHERE LOWER(name) = LOWER($1) LIMIT 1', [finalName]);
    }
    finalId = inserted.rows[0]?.id || null;
    finalName = inserted.rows[0]?.name || finalName;
  }
  await client.query('UPDATE users SET department_id = $2, department = $3 WHERE id = $1', [userId, finalId, finalName || null]);
}

async function getAnnualLeaveBalance(userId, db = pool) {
  const user = await queryOne(db,
    `SELECT employment_start_date, annual_leave_manual_adjustment FROM users WHERE id = $1`,
    [userId]
  );
  const now = new Date();
  const currentYear = now.getFullYear();
  const jan1 = new Date(currentYear, 0, 1);
  let start = user?.employment_start_date ? new Date(user.employment_start_date) : jan1;
  if (Number.isNaN(start.getTime())) start = jan1;
  if (start < jan1) start = jan1;
  let accrued = 0;
  if (start <= now) accrued = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1;
  accrued = toFixedNumber(accrued + Number(user?.annual_leave_manual_adjustment || 0));

  const usedResult = await db.query(
    `SELECT COALESCE(SUM(annual_leave_days_used), 0) AS used_days
     FROM leave_requests
     WHERE user_id = $1
       AND status = 'approved'
       AND annual_leave_days_used > 0
       AND EXTRACT(YEAR FROM from_date) = EXTRACT(YEAR FROM CURRENT_DATE)`,
    [userId]
  );
  const used = toFixedNumber(usedResult.rows[0]?.used_days || 0);
  return { accrued_days: accrued, used_days: used, remaining_days: toFixedNumber(accrued - used) };
}

function buildAccessibleWhere(user, scope, filters = {}) {
  const where = [];
  const params = [];
  const addParam = (value) => { params.push(value); return `$${params.length}`; };
  const currentScope = scope || 'mine';

  if (currentScope === 'mine') {
    where.push(`i.recruiter_id = ${addParam(user.id)}`);
  } else if (currentScope === 'department') {
    const deptNames = getManagedDepartmentNames(user);
    if (!canViewDepartment(user) || !deptNames.length) return { empty: true, params: [], whereSql: 'WHERE 1=0' };
    where.push(`COALESCE(d.name, r.department, '') = ANY(${addParam(deptNames)}::text[])`);
  } else if (currentScope === 'manage') {
    if (isAdmin(user)) {
    } else if (canManageInterviews(user)) {
      const companyIds = Array.isArray(user.company_ids) ? user.company_ids.map(Number).filter(Boolean) : [];
      if (!companyIds.length) return { empty: true, params: [], whereSql: 'WHERE 1=0' };
      where.push(`i.company_id = ANY(${addParam(companyIds)}::int[])`);
    } else {
      return { empty: true, params: [], whereSql: 'WHERE 1=0' };
    }
  } else {
    where.push(`i.recruiter_id = ${addParam(user.id)}`);
  }

  if (filters.company_id) {
    const companyId = Number(filters.company_id);
    if (companyId) where.push(`i.company_id = ${addParam(companyId)}`);
  }
  if (filters.status) where.push(`i.status = ${addParam(String(filters.status))}`);
  if (filters.interview_date) where.push(`i.interview_date = ${addParam(String(filters.interview_date))}`);
  if (filters.interview_shift) where.push(`i.interview_shift = ${addParam(String(filters.interview_shift))}`);
  if (filters.department_name) where.push(`COALESCE(d.name, r.department, '') ILIKE ${addParam(`%${String(filters.department_name).trim()}%`)}`);
  if (filters.recruiter_name) where.push(`COALESCE(r.full_name, '') ILIKE ${addParam(`%${String(filters.recruiter_name).trim()}%`)}`);
  if (filters.q) {
    const q = `%${String(filters.q).trim()}%`;
    if (q !== '%%') {
      const p = addParam(q);
      where.push(`(i.full_name ILIKE ${p} OR i.cccd_number ILIKE ${p} OR i.phone ILIKE ${p} OR c.name ILIKE ${p} OR COALESCE(r.full_name, '') ILIKE ${p} OR COALESCE(d.name, r.department, '') ILIKE ${p})`);
    }
  }

  return { params, whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', empty: false };
}

async function getInterviewById(id) {
  const { rows } = await pool.query(
    `SELECT i.id, i.interview_date, i.interview_shift, i.company_id, i.recruiter_id,
            i.full_name, i.cccd_number, i.birth_date, i.permanent_address,
            i.cccd_issue_date, i.cccd_expiry_date, i.phone, i.gender,
            i.status, i.result_note, i.result_updated_at, i.created_at, i.updated_at,
            c.name AS company_name,
            r.full_name AS recruiter_name,
            r.role AS recruiter_role,
            COALESCE(d.name, r.department) AS recruiter_department,
            ru.full_name AS result_updated_by_name
     FROM interview_forms i
     LEFT JOIN companies c ON c.id = i.company_id
     LEFT JOIN users r ON r.id = i.recruiter_id
     LEFT JOIN departments d ON d.id = r.department_id
     LEFT JOIN users ru ON ru.id = i.result_updated_by
     WHERE i.id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}
function canViewInterview(user, interview) {
  if (!user || !interview) return false;
  if (isAdmin(user)) return true;
  if (Number(user.id) === Number(interview.recruiter_id)) return true;
  if (canViewDepartment(user) && getManagedDepartmentNames(user).includes(String(interview.recruiter_department || ''))) return true;
  if (canManageInterviews(user) && (user.company_ids || []).includes(Number(interview.company_id))) return true;
  return false;
}
function canManageInterviewRecord(user, interview, nextCompanyId = null) {
  if (!user || !interview) return false;
  if (isAdmin(user)) return true;
  if (!canManageInterviews(user)) return false;
  const companyIds = Array.isArray(user.company_ids) ? user.company_ids.map(Number).filter(Boolean) : [];
  if (!companyIds.includes(Number(interview.company_id))) return false;
  if (nextCompanyId != null && Number(nextCompanyId) && !companyIds.includes(Number(nextCompanyId))) return false;
  return true;
}
async function baseLeaveQuery(whereSql = '', params = [], db = pool) {
  return db.query(
    `SELECT lr.*, u.username AS requester_username, u.email AS requester_email, u.full_name AS requester_name,
            u.role AS requester_role_current, COALESCE(d.name, u.department) AS department_name,
            a.full_name AS approver_name, a.username AS approver_username,
            COALESCE(a.role, lr.approver_role) AS approver_role_name
     FROM leave_requests lr
     JOIN users u ON lr.user_id = u.id
     LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN users a ON lr.approver_id = a.id
     ${whereSql}
     ORDER BY lr.id DESC`,
    params
  );
}
async function getValidApproversFor(user) {
  const myLevel = getRoleLevel(user.role);
  if (!myLevel || myLevel >= ROLE_LEVEL.ADMIN) return [];
  const currentDept = getDepartmentName(user);
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.role, COALESCE(d.name, u.department) AS department_name
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.is_active = TRUE
     ORDER BY u.full_name ASC`
  );
  return rows.filter((u) => {
    const higher = getRoleLevel(u.role) > myLevel;
    const sameDept = currentDept && safeLower(u.department_name) === safeLower(currentDept);
    return higher && (sameDept || normalizeRole(u.role) === 'ADMIN');
  }).map((u) => ({ id: u.id, full_name: u.full_name, role: normalizeRole(u.role), role_label: roleLabel(u.role), department_name: u.department_name }));
}

async function initDb() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS citext`).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS departments (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_name_unique ON departments (LOWER(name))`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      code VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_code_unique ON companies (LOWER(code)) WHERE code IS NOT NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE,
      email TEXT,
      password_hash TEXT,
      password TEXT,
      full_name VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'EMPLOYEE',
      account_type VARCHAR(30) NOT NULL DEFAULT 'NGUOI_TUYEN',
      department_id INTEGER,
      department VARCHAR(255),
      is_active BOOLEAN DEFAULT TRUE,
      employment_start_date DATE,
      annual_leave_manual_adjustment NUMERIC(10,3) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  const userAlters = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'EMPLOYEE'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type VARCHAR(30) NOT NULL DEFAULT 'NGUOI_TUYEN'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id INTEGER`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(255)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_start_date DATE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS annual_leave_manual_adjustment NUMERIC(10,3) NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`
  ];
  for (const sql of userAlters) await pool.query(sql);
  await pool.query(`ALTER TABLE users ALTER COLUMN annual_leave_manual_adjustment TYPE NUMERIC(10,3) USING COALESCE(annual_leave_manual_adjustment, 0)::numeric`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users (LOWER(username)) WHERE username IS NOT NULL`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users (LOWER(email)) WHERE email IS NOT NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_company_access (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (user_id, company_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_department_access (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (user_id, department_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS interview_forms (
      id SERIAL PRIMARY KEY,
      interview_date DATE NOT NULL,
      interview_shift VARCHAR(20) NOT NULL,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
      recruiter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      full_name VARCHAR(255) NOT NULL,
      cccd_number VARCHAR(20) NOT NULL,
      birth_date DATE NOT NULL,
      permanent_address TEXT NOT NULL,
      cccd_issue_date DATE NOT NULL,
      cccd_expiry_date DATE,
      phone VARCHAR(30) NOT NULL,
      gender VARCHAR(10) NOT NULL DEFAULT 'MALE',
      cccd_front_data BYTEA,
      cccd_front_mime VARCHAR(100),
      cccd_back_data BYTEA,
      cccd_back_mime VARCHAR(100),
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      result_note TEXT,
      result_updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      result_updated_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS interview_logs (
      id SERIAL PRIMARY KEY,
      form_id INTEGER NOT NULL REFERENCES interview_forms(id) ON DELETE CASCADE,
      action VARCHAR(100) NOT NULL,
      old_status VARCHAR(20),
      new_status VARCHAR(20),
      note TEXT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS leave_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      requester_role VARCHAR(40) NOT NULL DEFAULT 'EMPLOYEE',
      requester_department_id INTEGER,
      approver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approver_role VARCHAR(40),
      leave_type VARCHAR(100) NOT NULL,
      reason TEXT NOT NULL,
      from_date DATE NOT NULL,
      to_date DATE NOT NULL,
      start_hour INTEGER,
      start_minute INTEGER,
      end_hour INTEGER,
      end_minute INTEGER,
      start_time VARCHAR(10),
      end_time VARCHAR(10),
      annual_leave_days_used NUMERIC(10,3) NOT NULL DEFAULT 0,
      file_name TEXT,
      file_path TEXT,
      status VARCHAR(40) NOT NULL DEFAULT 'pending',
      approved_at TIMESTAMP,
      rejected_at TIMESTAMP,
      reject_reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`ALTER TABLE leave_requests ALTER COLUMN annual_leave_days_used TYPE NUMERIC(10,3) USING COALESCE(annual_leave_days_used, 0)::numeric`).catch(() => {});

  const { rows: userRows } = await pool.query(`SELECT id, role, account_type, username, email, department, department_id, full_name FROM users`);
  for (const row of userRows) {
    const normalizedRole = normalizeRole(row.role);
    const normalizedType = normalizeAccountType(row.account_type, row.role);
    let username = String(row.username || '').trim();
    const email = String(row.email || '').trim() || (username ? `${username.toLowerCase()}@local.local` : null);
    if (!username) username = String(email || `user${row.id}`).split('@')[0];
    await pool.query(
      `UPDATE users SET username = $2, email = COALESCE(email, $3), role = $4, account_type = $5, updated_at = NOW() WHERE id = $1`,
      [row.id, username, email, normalizedRole, normalizedType]
    );
  }

  await pool.query(`
    INSERT INTO departments(name)
    SELECT DISTINCT department
    FROM users
    WHERE department IS NOT NULL AND TRIM(department) <> ''
    ON CONFLICT DO NOTHING
  `).catch(() => {});

  await pool.query(`
    UPDATE users u
    SET department_id = d.id
    FROM departments d
    WHERE u.department_id IS NULL AND u.department IS NOT NULL AND LOWER(d.name) = LOWER(u.department)
  `).catch(() => {});

  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123456';
  const adminFullName = process.env.ADMIN_FULL_NAME || 'Quản trị hệ thống';
  const adminHash = await bcrypt.hash(adminPassword, 10);
  const existingAdmin = await queryOne(pool, `SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`, [adminUsername]);
  if (existingAdmin) {
    await pool.query(
      `UPDATE users SET full_name = COALESCE(NULLIF(full_name, ''), $2), role = 'ADMIN', account_type = 'QUAN_LY', is_active = TRUE,
       password_hash = COALESCE(password_hash, $3), password = COALESCE(password, $4), updated_at = NOW() WHERE id = $1`,
      [existingAdmin.id, adminFullName, adminHash, adminPassword]
    );
  } else {
    const inserted = await pool.query(
      `INSERT INTO users (username, email, password_hash, password, full_name, role, account_type, is_active, department)
       VALUES ($1, $2, $3, $4, $5, 'ADMIN', 'QUAN_LY', TRUE, 'Phòng chung') RETURNING id`,
      [adminUsername, `${adminUsername}@local.local`, adminHash, adminPassword, adminFullName]
    );
    await syncDepartmentFields(pool, inserted.rows[0].id, null, 'Phòng chung');
  }
}

app.get('/api/health', asyncHandler(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
}));

app.post('/api/login', asyncHandler(async (req, res) => {
  const login = String(req.body.username || req.body.email || '').trim();
  const password = String(req.body.password || '').trim();
  if (!login || !password) return res.status(400).json({ error: 'Vui lòng nhập tài khoản và mật khẩu.' });

  const user = await getUserByLogin(login);
  if (!user || user.is_active === false) return res.status(400).json({ error: 'Tài khoản không tồn tại hoặc đã bị khóa.' });
  let ok = false;
  if (user.password_hash) ok = await bcrypt.compare(password, user.password_hash).catch(() => false);
  if (!ok && user.password) ok = String(user.password) === password;
  if (!ok) return res.status(400).json({ error: 'Mật khẩu không đúng.' });

  const current = await getCurrentUser(user.id);
  setSessionUser(req, current);
  res.json({ message: 'Đăng nhập thành công.', user: current });
}));

app.post('/api/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ message: 'Đã đăng xuất.' }));
});

app.get('/api/me', requireAuth, asyncHandler(async (req, res) => {
  const current = await getCurrentUser(req.session.user.id);
  setSessionUser(req, current);
  res.json({ user: current });
}));

app.post('/api/change-password', requireAuth, asyncHandler(async (req, res) => {
  const currentPassword = String(req.body.current_password || '');
  const newPassword = String(req.body.new_password || '');
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Mật khẩu mới phải từ 6 ký tự.' });
  const user = await getUserById(req.session.user.id);
  let ok = false;
  if (user.password_hash) ok = await bcrypt.compare(currentPassword, user.password_hash).catch(() => false);
  if (!ok && user.password) ok = user.password === currentPassword;
  if (!ok) return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng.' });
  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query(`UPDATE users SET password_hash = $2, password = $3, updated_at = NOW() WHERE id = $1`, [user.id, hash, newPassword]);
  res.json({ message: 'Đổi mật khẩu thành công.' });
}));

app.get('/api/departments', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`SELECT id, name FROM departments ORDER BY name ASC`);
  res.json({ departments: rows });
}));
app.post('/api/departments', requireAdmin, asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Vui lòng nhập tên phòng ban.' });
  const existing = await queryOne(pool, `SELECT id, name FROM departments WHERE LOWER(name) = LOWER($1) LIMIT 1`, [name]);
  if (existing) return res.json({ message: 'Phòng ban đã tồn tại.', department: existing });
  const { rows } = await pool.query(`INSERT INTO departments(name) VALUES($1) RETURNING id, name`, [name]);
  res.json({ message: 'Đã tạo phòng ban.', department: rows[0] });
}));
app.put('/api/departments/:id', requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id); const name = String(req.body.name || '').trim();
  if (!id || !name) return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
  await pool.query(`UPDATE departments SET name = $2 WHERE id = $1`, [id, name]);
  await pool.query(`UPDATE users SET department = $2 WHERE department_id = $1`, [id, name]);
  res.json({ message: 'Đã cập nhật phòng ban.' });
}));
app.delete('/api/departments/:id', requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id); if (!id) return res.status(400).json({ error: 'ID không hợp lệ.' });
  await pool.query(`UPDATE users SET department_id = NULL WHERE department_id = $1`, [id]);
  await pool.query(`DELETE FROM departments WHERE id = $1`, [id]);
  res.json({ message: 'Đã xóa phòng ban.' });
}));

app.get('/api/companies', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`SELECT id, name, code, created_at FROM companies ORDER BY name ASC`);
  res.json({ companies: rows });
}));
app.post('/api/companies', requireAdmin, asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const code = String(req.body.code || '').trim() || null;
  if (!name) return res.status(400).json({ error: 'Vui lòng nhập tên công ty.' });
  const { rows } = await pool.query(`INSERT INTO companies(name, code) VALUES($1,$2) RETURNING *`, [name, code]);
  res.json({ message: 'Đã tạo công ty.', company: rows[0] });
}));
app.put('/api/companies/:id', requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id); const name = String(req.body.name || '').trim(); const code = String(req.body.code || '').trim() || null;
  if (!id || !name) return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
  const { rows } = await pool.query(`UPDATE companies SET name = $2, code = $3 WHERE id = $1 RETURNING *`, [id, name, code]);
  res.json({ message: 'Đã cập nhật công ty.', company: rows[0] });
}));
app.delete('/api/companies/:id', requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id); if (!id) return res.status(400).json({ error: 'ID không hợp lệ.' });
  await pool.query(`DELETE FROM user_company_access WHERE company_id = $1`, [id]);
  await pool.query(`DELETE FROM companies WHERE id = $1`, [id]);
  res.json({ message: 'Đã xóa công ty.' });
}));

app.get('/api/users', requireAdmin, asyncHandler(async (req, res) => {
  const where = [];
  const params = [];
  const addParam = (value) => { params.push(value); return `$${params.length}`; };
  if (req.query.role) where.push(`u.role = ${addParam(normalizeRole(req.query.role))}`);
  if (req.query.account_type) where.push(`u.account_type = ${addParam(normalizeAccountType(req.query.account_type, req.query.role))}`);
  if (req.query.department_id) {
    const departmentId = Number(req.query.department_id);
    if (departmentId) where.push(`u.department_id = ${addParam(departmentId)}`);
  }
  if (req.query.q) {
    const p = addParam(`%${String(req.query.q).trim()}%`);
    where.push(`(u.username ILIKE ${p} OR COALESCE(u.email, '') ILIKE ${p} OR u.full_name ILIKE ${p} OR COALESCE(d.name, u.department, '') ILIKE ${p})`);
  }
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.email, u.full_name, u.role, u.account_type, u.department_id,
            COALESCE(d.name, u.department) AS department_name, u.department, u.is_active, u.created_at,
            u.employment_start_date, u.annual_leave_manual_adjustment
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY u.created_at DESC, u.id DESC`,
    params
  );
  const enriched = await enrichUsers(rows);
  res.json({ users: enriched.map(mapUser) });
}));

app.post('/api/users', requireAdmin, asyncHandler(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '').trim() || '123456';
  const email = String(req.body.email || '').trim() || `${username || 'user'}@local.local`;
  const fullName = String(req.body.full_name || '').trim();
  const role = normalizeRole(req.body.role);
  const accountType = normalizeAccountType(req.body.account_type, role);
  const departmentId = req.body.department_id ? Number(req.body.department_id) : null;
  const departmentName = String(req.body.department_name || '').trim();
  const employmentStartDate = req.body.employment_start_date ? String(req.body.employment_start_date) : null;
  const annualAdjustment = parseDecimal(req.body.annual_leave_manual_adjustment, 0);
  const companyIds = Array.isArray(req.body.company_ids) ? req.body.company_ids : String(req.body.company_ids || '').split(',').filter(Boolean);
  const managedDepartmentIds = Array.isArray(req.body.managed_department_ids) ? req.body.managed_department_ids : String(req.body.managed_department_ids || '').split(',').filter(Boolean);
  if (!username || !fullName) return res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và họ tên.' });
  const hash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO users(username, email, password_hash, password, full_name, role, account_type, is_active, employment_start_date, annual_leave_manual_adjustment)
       VALUES($1,$2,$3,$4,$5,$6,$7,TRUE,$8,$9) RETURNING id`,
      [username, email, hash, password, fullName, role, accountType, employmentStartDate, annualAdjustment]
    );
    await syncDepartmentFields(client, inserted.rows[0].id, departmentId, departmentName);
    await client.query('DELETE FROM user_company_access WHERE user_id = $1', [inserted.rows[0].id]);
    if (accountType === 'QUAN_LY') {
      for (const companyId of companyIds.map(Number).filter(Boolean)) {
        await client.query(`INSERT INTO user_company_access(user_id, company_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [inserted.rows[0].id, companyId]);
      }
    }
    await client.query('DELETE FROM user_department_access WHERE user_id = $1', [inserted.rows[0].id]);
    for (const departmentIdItem of managedDepartmentIds.map(Number).filter(Boolean)) {
      await client.query(`INSERT INTO user_department_access(user_id, department_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [inserted.rows[0].id, departmentIdItem]);
    }
    await client.query('COMMIT');
    const user = await getCurrentUser(inserted.rows[0].id);
    res.json({ message: 'Đã tạo tài khoản.', user });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}));

app.put('/api/users/:id', requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id); if (!id) return res.status(400).json({ error: 'ID không hợp lệ.' });
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim() || null;
  const fullName = String(req.body.full_name || '').trim();
  const role = normalizeRole(req.body.role);
  const accountType = normalizeAccountType(req.body.account_type, role);
  const departmentId = req.body.department_id ? Number(req.body.department_id) : null;
  const departmentName = String(req.body.department_name || '').trim();
  const employmentStartDate = req.body.employment_start_date ? String(req.body.employment_start_date) : null;
  const annualAdjustment = parseDecimal(req.body.annual_leave_manual_adjustment, 0);
  const isActive = String(req.body.is_active).toLowerCase() !== 'false';
  const password = String(req.body.password || '').trim();
  const companyIds = Array.isArray(req.body.company_ids) ? req.body.company_ids : String(req.body.company_ids || '').split(',').filter(Boolean);
  const managedDepartmentIds = Array.isArray(req.body.managed_department_ids) ? req.body.managed_department_ids : String(req.body.managed_department_ids || '').split(',').filter(Boolean);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await client.query(`UPDATE users SET username=$2, email=$3, full_name=$4, role=$5, account_type=$6, is_active=$7, employment_start_date=$8, annual_leave_manual_adjustment=$9, password_hash=$10, password=$11, updated_at = NOW() WHERE id=$1`,
        [id, username, email, fullName, role, accountType, isActive, employmentStartDate, annualAdjustment, hash, password]);
    } else {
      await client.query(`UPDATE users SET username=$2, email=$3, full_name=$4, role=$5, account_type=$6, is_active=$7, employment_start_date=$8, annual_leave_manual_adjustment=$9, updated_at = NOW() WHERE id=$1`,
        [id, username, email, fullName, role, accountType, isActive, employmentStartDate, annualAdjustment]);
    }
    await syncDepartmentFields(client, id, departmentId, departmentName);
    await client.query('DELETE FROM user_company_access WHERE user_id = $1', [id]);
    if (accountType === 'QUAN_LY') {
      for (const companyId of companyIds.map(Number).filter(Boolean)) {
        await client.query(`INSERT INTO user_company_access(user_id, company_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [id, companyId]);
      }
    }
    await client.query('DELETE FROM user_department_access WHERE user_id = $1', [id]);
    for (const departmentIdItem of managedDepartmentIds.map(Number).filter(Boolean)) {
      await client.query(`INSERT INTO user_department_access(user_id, department_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [id, departmentIdItem]);
    }
    await client.query('COMMIT');
    const user = await getCurrentUser(id);
    if (req.session.user.id === id) setSessionUser(req, user);
    res.json({ message: 'Đã cập nhật tài khoản.', user });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}));
app.delete('/api/users/:id', requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id); if (!id) return res.status(400).json({ error: 'ID không hợp lệ.' });
  if (id === req.session.user.id) return res.status(400).json({ error: 'Không thể xóa tài khoản đang đăng nhập.' });
  await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
  res.json({ message: 'Đã xóa tài khoản.' });
}));

app.get('/api/stats', requireAuth, asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req.session.user.id);
  const leaveMine = await pool.query(`SELECT COUNT(*)::int AS total, COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),0)::int AS pending, COALESCE(SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END),0)::int AS approved, COALESCE(SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END),0)::int AS rejected FROM leave_requests WHERE user_id = $1`, [user.id]);
  const builtMine = buildAccessibleWhere(user, 'mine');
  const builtDept = buildAccessibleWhere(user, 'department');
  const builtManage = buildAccessibleWhere(user, 'manage');
  const getInterviewCount = async (built) => {
    if (built.empty) return { total: 0, pending: 0, passed: 0, failed: 0 };
    const r = await pool.query(`SELECT COUNT(*)::int AS total, COALESCE(SUM(CASE WHEN i.status='PENDING' THEN 1 ELSE 0 END),0)::int AS pending, COALESCE(SUM(CASE WHEN i.status='PASSED' THEN 1 ELSE 0 END),0)::int AS passed, COALESCE(SUM(CASE WHEN i.status='FAILED' THEN 1 ELSE 0 END),0)::int AS failed FROM interview_forms i LEFT JOIN companies c ON c.id=i.company_id LEFT JOIN users r ON r.id=i.recruiter_id ${built.whereSql}`, built.params);
    return r.rows[0];
  };
  const mine = await getInterviewCount(builtMine);
  const dept = await getInterviewCount(builtDept);
  const manage = await getInterviewCount(builtManage);
  const balance = await getAnnualLeaveBalance(user.id);
  res.json({
    leave: leaveMine.rows[0],
    interviews: { mine, department: dept, manage },
    annual_leave_balance: balance
  });
}));

app.get('/api/approvers', requireAuth, asyncHandler(async (req, res) => {
  const approvers = await getValidApproversFor(req.session.user);
  res.json({ approvers });
}));
app.get('/api/annual-leave-balance', requireAuth, asyncHandler(async (req, res) => {
  res.json(await getAnnualLeaveBalance(req.session.user.id));
}));

app.post('/api/leave', requireAuth, leaveUpload.single('attachment'), asyncHandler(async (req, res) => {
  const currentUser = await getCurrentUser(req.session.user.id);
  const approverId = Number(req.body.approver_id || 0);
  const fromDate = String(req.body.from_date || '').trim();
  const toDate = String(req.body.to_date || '').trim();
  const reason = String(req.body.reason || '').trim();
  let annualLeaveDaysUsed = parseDecimal(req.body.annual_leave_days_used, 0);
  const rawLeaveType = safeLower(req.body.leave_type);
  const leaveType = rawLeaveType === 'nghi_om' ? 'Nghỉ ốm' : rawLeaveType === 'nghi_viec_rieng' ? 'Nghỉ việc riêng' : 'Nghỉ phép';
  if (!approverId || !fromDate || !toDate || !reason) return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin đơn nghỉ.' });
  if (!isValidDateInput(fromDate) || !isValidDateInput(toDate)) return res.status(400).json({ error: 'Ngày nghỉ không hợp lệ.' });
  if (leaveType !== 'Nghỉ phép') annualLeaveDaysUsed = 0;
  if (leaveType === 'Nghỉ phép' && annualLeaveDaysUsed <= 0) return res.status(400).json({ error: 'Nếu chọn nghỉ phép thì phải nhập số phép năm sử dụng.' });

  const approver = await getUserById(approverId);
  if (!approver) return res.status(404).json({ error: 'Không tìm thấy người ký.' });
  if (getRoleLevel(approver.role) <= getRoleLevel(currentUser.role)) return res.status(400).json({ error: 'Người ký phải có cấp cao hơn người tạo đơn.' });
  const sameDept = safeLower(getDepartmentName(currentUser)) && safeLower(getDepartmentName(currentUser)) === safeLower(approver.department_name || approver.department);
  if (!sameDept && normalizeRole(approver.role) !== 'ADMIN') return res.status(400).json({ error: 'Người ký phải cùng phòng ban hoặc là Admin.' });

  if (annualLeaveDaysUsed > 0) {
    const balance = await getAnnualLeaveBalance(currentUser.id);
    if (annualLeaveDaysUsed > balance.remaining_days) return res.status(400).json({ error: `Phép năm còn lại không đủ. Hiện còn ${balance.remaining_days} phép.` });
  }
  const startParts = req.body.start_time ? timePartsFromValue(req.body.start_time) : { hour: req.body.start_hour || null, minute: req.body.start_minute || null, time: buildTimeValue(req.body.start_hour, req.body.start_minute) };
  const endParts = req.body.end_time ? timePartsFromValue(req.body.end_time) : { hour: req.body.end_hour || null, minute: req.body.end_minute || null, time: buildTimeValue(req.body.end_hour, req.body.end_minute) };
  const fileName = req.file ? req.file.originalname : null;
  const filePath = req.file ? `uploads/${req.file.filename}` : null;
  const { rows } = await pool.query(
    `INSERT INTO leave_requests(user_id, requester_role, requester_department_id, approver_id, approver_role, leave_type, reason, from_date, to_date, start_hour, start_minute, end_hour, end_minute, start_time, end_time, annual_leave_days_used, file_name, file_path, status, created_at, updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'pending',NOW(),NOW()) RETURNING id`,
    [currentUser.id, currentUser.role, currentUser.department_id, approver.id, normalizeRole(approver.role), leaveType, reason, fromDate, toDate,
      startParts.hour, startParts.minute, endParts.hour, endParts.minute, startParts.time, endParts.time, annualLeaveDaysUsed, fileName, filePath]
  );
  const result = await baseLeaveQuery('WHERE lr.id = $1', [rows[0].id]);
  res.json({ message: 'Đã tạo đơn nghỉ.', leave: mapLeaveRow(result.rows[0]) });
}));

app.get('/api/leaves', requireAuth, asyncHandler(async (req, res) => {
  const user = req.session.user;
  const view = String(req.query.view || 'mine');
  const where = [];
  const params = [];
  const addParam = (value) => { params.push(value); return `$${params.length}`; };
  const managedDepts = getManagedDepartmentNames(user);

  if (view === 'mine') {
    where.push(`lr.user_id = ${addParam(user.id)}`);
  } else if (view === 'pending') {
    where.push(`lr.approver_id = ${addParam(user.id)} AND lr.status = 'pending'`);
  } else if (view === 'signed_by_me') {
    where.push(`lr.approver_id = ${addParam(user.id)} AND lr.status IN ('approved','rejected')`);
  } else if (view === 'team_signed') {
    if (isAdmin(user)) {
      where.push(`lr.status IN ('approved','rejected')`);
    } else if (canViewDepartment(user) && managedDepts.length) {
      where.push(`COALESCE(d.name, u.department, '') = ANY(${addParam(managedDepts)}::text[]) AND lr.status IN ('approved','rejected')`);
    } else {
      where.push(`lr.approver_id = ${addParam(user.id)} AND lr.status IN ('approved','rejected')`);
    }
  } else if (view === 'all') {
    if (isAdmin(user)) {
    } else if (canViewDepartment(user) && managedDepts.length) {
      where.push(`COALESCE(d.name, u.department, '') = ANY(${addParam(managedDepts)}::text[])`);
    } else {
      where.push(`lr.user_id = ${addParam(user.id)}`);
    }
  } else {
    where.push(`lr.user_id = ${addParam(user.id)}`);
  }

  if (req.query.status) where.push(`lr.status = ${addParam(String(req.query.status))}`);
  if (req.query.q) {
    const p = addParam(`%${String(req.query.q).trim()}%`);
    where.push(`(COALESCE(u.full_name, '') ILIKE ${p} OR COALESCE(a.full_name, '') ILIKE ${p} OR COALESCE(u.username, '') ILIKE ${p} OR COALESCE(d.name, u.department, '') ILIKE ${p} OR COALESCE(lr.reason, '') ILIKE ${p})`);
  }
  const result = await baseLeaveQuery(where.length ? `WHERE ${where.join(' AND ')}` : '', params);
  res.json({ leaves: result.rows.map(mapLeaveRow) });
}));

async function approveOrRejectLeave(req, res, action) {
  const leaveId = Number(req.params.id);
  if (!leaveId) return res.status(400).json({ error: 'ID đơn không hợp lệ.' });
  const rejectReason = req.body?.reject_reason || req.body?.decision_note || req.body?.reason || null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leave = await queryOne(client, `SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE`, [leaveId]);
    if (!leave) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Không tìm thấy đơn.' }); }
    if (leave.status !== 'pending') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Đơn này đã được xử lý.' }); }
    if (Number(leave.approver_id || 0) !== Number(req.session.user.id)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Bạn không có quyền xử lý đơn này.' }); }
    if (action === 'approve') {
      await client.query(`UPDATE leave_requests SET status='approved', approved_at=NOW(), rejected_at=NULL, reject_reason=NULL, updated_at=NOW() WHERE id=$1`, [leaveId]);
    } else {
      await client.query(`UPDATE leave_requests SET status='rejected', rejected_at=NOW(), reject_reason=$2, updated_at=NOW() WHERE id=$1`, [leaveId, rejectReason || null]);
    }
    await client.query('COMMIT');
    return res.json({ message: action === 'approve' ? 'Duyệt đơn thành công.' : 'Từ chối đơn thành công.' });
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { client.release(); }
}
app.post('/api/leaves/:id/approve', requireAuth, requireApprover, asyncHandler(async (req, res) => approveOrRejectLeave(req, res, 'approve')));
app.post('/api/leaves/:id/reject', requireAuth, requireApprover, asyncHandler(async (req, res) => approveOrRejectLeave(req, res, 'reject')));
app.get('/api/leaves/:id/download', requireAuth, asyncHandler(async (req, res) => {
  const leaveId = Number(req.params.id);
  const result = await baseLeaveQuery(`WHERE lr.id = $1`, [leaveId]);
  const leave = result.rows[0];
  if (!leave) return res.status(404).send('Không tìm thấy đơn.');
  const canAccess = isAdmin(req.session.user) || Number(leave.user_id) === Number(req.session.user.id) || Number(leave.approver_id) === Number(req.session.user.id) || (canViewDepartment(req.session.user) && safeLower(leave.department_name) === safeLower(getDepartmentName(req.session.user)));
  if (!canAccess) return res.status(403).send('Bạn không có quyền tải file này.');
  if (!leave.file_path) return res.status(404).send('Đơn này không có file đính kèm.');
  const absPath = path.join(__dirname, leave.file_path);
  if (!fs.existsSync(absPath)) return res.status(404).send('File không còn tồn tại trên server.');
  res.download(absPath, leave.file_name || path.basename(absPath));
}));

app.post('/api/interviews', requireAuth, imageUpload.fields([{ name: 'cccd_front', maxCount: 1 }, { name: 'cccd_back', maxCount: 1 }]), asyncHandler(async (req, res) => {
  const companyId = Number(req.body.company_id);
  const interviewDate = String(req.body.interview_date || '').trim();
  const interviewShift = safeUpper(req.body.interview_shift);
  const fullName = String(req.body.full_name || '').trim();
  const gender = safeUpper(req.body.gender);
  const cccdNumber = normalizeDigits(req.body.cccd_number);
  const birthDate = String(req.body.birth_date || '').trim();
  const address = String(req.body.permanent_address || '').trim();
  const cccdIssueDate = String(req.body.cccd_issue_date || '').trim();
  const cccdExpiryDate = req.body.cccd_expiry_date ? String(req.body.cccd_expiry_date).trim() : null;
  const phone = normalizeDigits(req.body.phone);
  if (!companyId || !interviewDate || !fullName || !birthDate || !address || !cccdIssueDate) return res.status(400).json({ error: 'Vui lòng nhập đủ thông tin bắt buộc.' });
  if (!['MORNING', 'AFTERNOON'].includes(interviewShift)) return res.status(400).json({ error: 'Ca phỏng vấn không hợp lệ.' });
  if (!['MALE', 'FEMALE'].includes(gender)) return res.status(400).json({ error: 'Giới tính không hợp lệ.' });
  if (cccdNumber.length !== 12) return res.status(400).json({ error: 'Số CCCD phải đủ 12 số.' });
  if (phone.length !== 10) return res.status(400).json({ error: 'Số điện thoại phải đủ 10 số.' });
  for (const item of [interviewDate, birthDate, cccdIssueDate]) if (!isValidDateInput(item)) return res.status(400).json({ error: 'Có ngày tháng không hợp lệ.' });
  if (cccdExpiryDate && !isValidDateInput(cccdExpiryDate)) return res.status(400).json({ error: 'Ngày hết hạn CCCD không hợp lệ.' });
  if (cccdExpiryDate && new Date(cccdIssueDate) > new Date(cccdExpiryDate)) return res.status(400).json({ error: 'Ngày cấp CCCD không được lớn hơn ngày hết hạn CCCD.' });
  const companyCheck = await queryOne(pool, `SELECT id FROM companies WHERE id = $1 LIMIT 1`, [companyId]);
  if (!companyCheck) return res.status(400).json({ error: 'Công ty không tồn tại.' });
  const duplicate = await queryOne(pool, `SELECT id FROM interview_forms WHERE company_id = $1 AND interview_date = $2 AND cccd_number = $3 LIMIT 1`, [companyId, interviewDate, cccdNumber]);
  if (duplicate) return res.status(400).json({ error: 'CCCD này đã được đăng ký cho công ty và ngày phỏng vấn này rồi.' });
  const front = req.files?.cccd_front?.[0] || null;
  const back = req.files?.cccd_back?.[0] || null;
  const { rows } = await pool.query(
    `INSERT INTO interview_forms(interview_date, interview_shift, company_id, recruiter_id, full_name, cccd_number, birth_date, permanent_address, cccd_issue_date, cccd_expiry_date, phone, gender, cccd_front_data, cccd_front_mime, cccd_back_data, cccd_back_mime)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [interviewDate, interviewShift, companyId, req.session.user.id, fullName, cccdNumber, birthDate, address, cccdIssueDate, cccdExpiryDate, phone, gender,
      front ? front.buffer : null, front ? front.mimetype : null, back ? back.buffer : null, back ? back.mimetype : null]
  );
  await addInterviewLog({ formId: rows[0].id, action: 'CREATE', newStatus: 'PENDING', note: 'Tạo hồ sơ phỏng vấn', userId: req.session.user.id });
  res.json({ message: 'Đã tạo hồ sơ phỏng vấn.', interview: mapInterview(await getInterviewById(rows[0].id)) });
}));

app.get('/api/interviews', requireAuth, asyncHandler(async (req, res) => {
  const scope = String(req.query.scope || 'mine');
  const built = buildAccessibleWhere(req.session.user, scope, req.query);
  if (built.empty) return res.json({ interviews: [] });
  const { rows } = await pool.query(
    `SELECT i.id, i.interview_date, i.interview_shift, i.company_id, i.recruiter_id, i.full_name, i.cccd_number, i.birth_date, i.permanent_address,
            i.cccd_issue_date, i.cccd_expiry_date, i.phone, i.gender, i.status, i.result_note, i.result_updated_at, i.created_at, i.updated_at,
            c.name AS company_name, r.full_name AS recruiter_name, r.role AS recruiter_role,
            COALESCE(d.name, r.department) AS recruiter_department, ru.full_name AS result_updated_by_name
     FROM interview_forms i
     LEFT JOIN companies c ON c.id = i.company_id
     LEFT JOIN users r ON r.id = i.recruiter_id
     LEFT JOIN departments d ON d.id = r.department_id
     LEFT JOIN users ru ON ru.id = i.result_updated_by
     ${built.whereSql}
     ORDER BY i.interview_date DESC, i.created_at DESC, i.id DESC
     LIMIT 1000`,
    built.params
  );
  res.json({ interviews: rows.map(mapInterview) });
}));

app.get('/api/interviews/:id', requireAuth, asyncHandler(async (req, res) => {
  const interview = await getInterviewById(Number(req.params.id));
  if (!interview) return res.status(404).json({ error: 'Không tìm thấy hồ sơ.' });
  if (!canViewInterview(req.session.user, interview)) return res.status(403).json({ error: 'Bạn không có quyền xem hồ sơ này.' });
  res.json({ interview: mapInterview(interview) });
}));

app.get('/api/interviews/:id/image/:side', requireAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const side = req.params.side === 'back' ? 'back' : 'front';
  const interview = await getInterviewById(id);
  if (!interview) return res.status(404).send('Không tìm thấy ảnh.');
  if (!canViewInterview(req.session.user, interview)) return res.status(403).send('Không có quyền xem ảnh.');
  const columnData = side === 'front' ? 'cccd_front_data' : 'cccd_back_data';
  const columnMime = side === 'front' ? 'cccd_front_mime' : 'cccd_back_mime';
  const row = await queryOne(pool, `SELECT ${columnData} AS data, ${columnMime} AS mime FROM interview_forms WHERE id = $1`, [id]);
  if (!row?.data) return res.status(404).send('Không có ảnh.');
  res.setHeader('Content-Type', row.mime || 'application/octet-stream');
  res.end(row.data);
}));

app.put('/api/interviews/:id', requireManagePermission, imageUpload.fields([{ name: 'cccd_front', maxCount: 1 }, { name: 'cccd_back', maxCount: 1 }]), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const interview = await getInterviewById(id);
  if (!interview) return res.status(404).json({ error: 'Không tìm thấy hồ sơ.' });
  const companyId = Number(req.body.company_id);
  if (!canManageInterviewRecord(req.session.user, interview, companyId)) return res.status(403).json({ error: 'Bạn không có quyền sửa hồ sơ này.' });
  const interviewDate = String(req.body.interview_date || '').trim();
  const interviewShift = safeUpper(req.body.interview_shift);
  const fullName = String(req.body.full_name || '').trim();
  const gender = safeUpper(req.body.gender);
  const cccdNumber = normalizeDigits(req.body.cccd_number);
  const birthDate = String(req.body.birth_date || '').trim();
  const permanentAddress = String(req.body.permanent_address || '').trim();
  const cccdIssueDate = String(req.body.cccd_issue_date || '').trim();
  const cccdExpiryDate = req.body.cccd_expiry_date ? String(req.body.cccd_expiry_date).trim() : null;
  const phone = normalizeDigits(req.body.phone);
  if (!companyId || !fullName || !interviewDate || !birthDate || !permanentAddress || !cccdIssueDate) return res.status(400).json({ error: 'Vui lòng nhập đủ tất cả thông tin bắt buộc.' });
  if (!['MORNING', 'AFTERNOON'].includes(interviewShift)) return res.status(400).json({ error: 'Ca phỏng vấn không hợp lệ.' });
  if (!['MALE', 'FEMALE'].includes(gender)) return res.status(400).json({ error: 'Giới tính không hợp lệ.' });
  if (cccdNumber.length !== 12) return res.status(400).json({ error: 'Số CCCD phải đủ 12 số.' });
  if (phone.length !== 10) return res.status(400).json({ error: 'Số điện thoại phải đủ 10 số.' });
  for (const item of [interviewDate, birthDate, cccdIssueDate]) if (!isValidDateInput(item)) return res.status(400).json({ error: 'Có ngày tháng không hợp lệ.' });
  if (cccdExpiryDate && !isValidDateInput(cccdExpiryDate)) return res.status(400).json({ error: 'Ngày hết hạn CCCD không hợp lệ.' });
  if (cccdExpiryDate && new Date(cccdIssueDate) > new Date(cccdExpiryDate)) return res.status(400).json({ error: 'Ngày cấp CCCD không được lớn hơn ngày hết hạn CCCD.' });
  const dup = await queryOne(pool, `SELECT id FROM interview_forms WHERE cccd_number = $1 AND company_id = $2 AND interview_date = $3 AND id <> $4 LIMIT 1`, [cccdNumber, companyId, interviewDate, id]);
  if (dup) return res.status(400).json({ error: 'Đã tồn tại hồ sơ cùng CCCD, cùng công ty và cùng ngày phỏng vấn.' });
  const front = req.files?.cccd_front?.[0] || null;
  const back = req.files?.cccd_back?.[0] || null;
  const sql = `UPDATE interview_forms SET interview_date=$2, interview_shift=$3, company_id=$4, full_name=$5, cccd_number=$6, birth_date=$7, permanent_address=$8, cccd_issue_date=$9, cccd_expiry_date=$10, phone=$11, gender=$12, updated_at=NOW(),
               cccd_front_data = COALESCE($13, cccd_front_data), cccd_front_mime = COALESCE($14, cccd_front_mime), cccd_back_data = COALESCE($15, cccd_back_data), cccd_back_mime = COALESCE($16, cccd_back_mime)
               WHERE id=$1`;
  await pool.query(sql, [id, interviewDate, interviewShift, companyId, fullName, cccdNumber, birthDate, permanentAddress, cccdIssueDate, cccdExpiryDate, phone, gender,
    front ? front.buffer : null, front ? front.mimetype : null, back ? back.buffer : null, back ? back.mimetype : null]);
  await addInterviewLog({ formId: id, action: 'UPDATE', note: 'Sửa hồ sơ phỏng vấn', userId: req.session.user.id });
  res.json({ message: 'Đã cập nhật hồ sơ.', interview: mapInterview(await getInterviewById(id)) });
}));

app.put('/api/interviews/:id/result', requireManagePermission, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const interview = await getInterviewById(id);
  if (!interview) return res.status(404).json({ error: 'Không tìm thấy hồ sơ.' });
  if (!canManageInterviewRecord(req.session.user, interview)) return res.status(403).json({ error: 'Bạn không có quyền cập nhật kết quả.' });
  const status = safeUpper(req.body.status);
  const note = String(req.body.result_note || '').trim() || null;
  if (!['PENDING', 'PASSED', 'FAILED'].includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
  await pool.query(`UPDATE interview_forms SET status=$2, result_note=$3, result_updated_by=$4, result_updated_at=NOW(), updated_at=NOW() WHERE id=$1`, [id, status, note, req.session.user.id]);
  await addInterviewLog({ formId: id, action: 'UPDATE_RESULT', oldStatus: interview.status, newStatus: status, note, userId: req.session.user.id });
  res.json({ message: 'Đã cập nhật kết quả.', interview: mapInterview(await getInterviewById(id)) });
}));

app.delete('/api/interviews/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id); const interview = await getInterviewById(id);
  if (!interview) return res.status(404).json({ error: 'Không tìm thấy hồ sơ.' });
  const canDelete = isAdmin(req.session.user) || canManageInterviewRecord(req.session.user, interview);
  if (!canDelete) return res.status(403).json({ error: 'Bạn không có quyền xóa hồ sơ này.' });
  await pool.query(`DELETE FROM interview_forms WHERE id = $1`, [id]);
  res.json({ message: 'Đã xóa hồ sơ.' });
}));

app.get('/api/interviews/export.xlsx', requireAuth, asyncHandler(async (req, res) => {
  const scope = String(req.query.scope || 'manage');
  if (scope === 'manage' && !canManageInterviews(req.session.user)) return res.status(403).json({ error: 'Bạn không có quyền xuất Excel ở mục này.' });
  if (scope === 'department' && !canViewDepartment(req.session.user)) return res.status(403).json({ error: 'Bạn không có quyền xuất Excel ở mục này.' });
  const built = buildAccessibleWhere(req.session.user, scope, req.query);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Ho so phong van');
  sheet.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Ngày phỏng vấn', key: 'interview_date', width: 14 },
    { header: 'Ca', key: 'interview_shift', width: 12 },
    { header: 'Công ty', key: 'company_name', width: 24 },
    { header: 'Người tạo', key: 'recruiter_name', width: 20 },
    { header: 'Phòng ban', key: 'recruiter_department', width: 16 },
    { header: 'Họ tên', key: 'full_name', width: 22 },
    { header: 'Giới tính', key: 'gender', width: 10 },
    { header: 'CCCD', key: 'cccd_number', width: 18 },
    { header: 'Ngày sinh', key: 'birth_date', width: 14 },
    { header: 'SĐT', key: 'phone', width: 14 },
    { header: 'Quê quán', key: 'permanent_address', width: 30 },
    { header: 'Ngày cấp CCCD', key: 'cccd_issue_date', width: 14 },
    { header: 'Ngày hết hạn CCCD', key: 'cccd_expiry_date', width: 16 },
    { header: 'Trạng thái', key: 'status', width: 14 },
    { header: 'Ghi chú', key: 'result_note', width: 30 },
  ];
  if (!built.empty) {
    const { rows } = await pool.query(
      `SELECT i.id, i.interview_date, i.interview_shift, c.name AS company_name, r.full_name AS recruiter_name,
              COALESCE(d.name, r.department) AS recruiter_department, i.full_name, i.gender, i.cccd_number, i.birth_date,
              i.phone, i.permanent_address, i.cccd_issue_date, i.cccd_expiry_date, i.status, i.result_note
       FROM interview_forms i
       LEFT JOIN companies c ON c.id = i.company_id
       LEFT JOIN users r ON r.id = i.recruiter_id
       LEFT JOIN departments d ON d.id = r.department_id
       ${built.whereSql}
       ORDER BY i.interview_date DESC, i.created_at DESC, i.id DESC`,
      built.params
    );
    rows.forEach((row) => sheet.addRow({ ...row, interview_shift: labelShift(row.interview_shift), gender: labelGender(row.gender), status: labelStatus(row.status) }));
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="ho-so-phong-van.xlsx"');
  await workbook.xlsx.write(res); res.end();
}));

app.get('/api/interviews/import-template', requireAuth, asyncHandler(async (req, res) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Mau import');
  sheet.columns = [
    { header: 'Ngày phỏng vấn', key: 'interview_date', width: 16 },
    { header: 'Ca phỏng vấn', key: 'interview_shift', width: 14 },
    { header: 'Công ty', key: 'company_name', width: 24 },
    { header: 'Họ và tên', key: 'full_name', width: 22 },
    { header: 'Giới tính', key: 'gender', width: 12 },
    { header: 'Số CCCD', key: 'cccd_number', width: 18 },
    { header: 'Ngày sinh', key: 'birth_date', width: 16 },
    { header: 'Số điện thoại', key: 'phone', width: 16 },
    { header: 'Quê quán thường trú', key: 'permanent_address', width: 28 },
    { header: 'Ngày cấp CCCD', key: 'cccd_issue_date', width: 16 },
    { header: 'Ngày hết hạn CCCD', key: 'cccd_expiry_date', width: 16 },
    { header: 'Ghi chú', key: 'note', width: 24 },
  ];
  sheet.addRow({
    interview_date: '2026-04-10', interview_shift: 'Ca sáng', company_name: 'Tên công ty', full_name: 'Nguyễn Văn A', gender: 'Nam', cccd_number: '123456789012',
    birth_date: '2000-01-01', phone: '0912345678', permanent_address: 'Bắc Giang', cccd_issue_date: '2020-01-01', cccd_expiry_date: '', note: ''
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="mau-import-ho-so.xlsx"');
  await workbook.xlsx.write(res); res.end();
}));

app.post('/api/interviews/import-excel', requireAuth, requireManagePermission, excelUpload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Vui lòng chọn file Excel.' });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(req.file.buffer).catch(async () => { await workbook.csv.read(req.file.buffer); });
  const sheet = workbook.worksheets[0];
  if (!sheet) return res.status(400).json({ error: 'File Excel không có dữ liệu.' });
  const companies = await pool.query(`SELECT id, name FROM companies`);
  const companyMap = new Map(companies.rows.map((c) => [safeLower(c.name), c.id]));
  const allowedCompanyIds = isAdmin(req.session.user) ? null : (req.session.user.company_ids || []).map(Number);
  const results = [];
  let success = 0;
  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const interviewDate = String(row.getCell(1).text || '').trim();
    const shiftText = safeLower(row.getCell(2).text || '');
    const companyName = String(row.getCell(3).text || '').trim();
    const fullName = String(row.getCell(4).text || '').trim();
    const genderText = safeLower(row.getCell(5).text || '');
    const cccdNumber = normalizeDigits(row.getCell(6).text || '');
    const birthDate = String(row.getCell(7).text || '').trim();
    const phone = normalizeDigits(row.getCell(8).text || '');
    const permanentAddress = String(row.getCell(9).text || '').trim();
    const cccdIssueDate = String(row.getCell(10).text || '').trim();
    const cccdExpiryDate = String(row.getCell(11).text || '').trim() || null;
    let message = 'Thành công';
    try {
      const interviewShift = shiftText.includes('chiều') ? 'AFTERNOON' : 'MORNING';
      const gender = genderText.includes('nữ') ? 'FEMALE' : 'MALE';
      const companyId = companyMap.get(safeLower(companyName));
      if (!companyId) throw new Error('Công ty không tồn tại trong hệ thống');
      if (allowedCompanyIds && !allowedCompanyIds.includes(Number(companyId))) throw new Error('Bạn không có quyền import vào công ty này');
      if (!fullName || !interviewDate || !birthDate || !permanentAddress || !cccdIssueDate) throw new Error('Thiếu thông tin bắt buộc');
      if (cccdNumber.length !== 12) throw new Error('CCCD phải đủ 12 số');
      if (phone.length !== 10) throw new Error('Số điện thoại phải đủ 10 số');
      for (const d of [interviewDate, birthDate, cccdIssueDate]) if (!isValidDateInput(d)) throw new Error('Ngày tháng không hợp lệ');
      if (cccdExpiryDate && !isValidDateInput(cccdExpiryDate)) throw new Error('Ngày hết hạn CCCD không hợp lệ');
      const dup = await queryOne(pool, `SELECT id FROM interview_forms WHERE cccd_number = $1 AND company_id = $2 AND interview_date = $3 LIMIT 1`, [cccdNumber, companyId, interviewDate]);
      if (dup) throw new Error('Đã tồn tại hồ sơ trùng CCCD + công ty + ngày phỏng vấn');
      const inserted = await pool.query(
        `INSERT INTO interview_forms(interview_date, interview_shift, company_id, recruiter_id, full_name, cccd_number, birth_date, permanent_address, cccd_issue_date, cccd_expiry_date, phone, gender)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [interviewDate, interviewShift, companyId, req.session.user.id, fullName, cccdNumber, birthDate, permanentAddress, cccdIssueDate, cccdExpiryDate, phone, gender]
      );
      await addInterviewLog({ formId: inserted.rows[0].id, action: 'IMPORT_EXCEL', newStatus: 'PENDING', note: 'Import Excel', userId: req.session.user.id });
      success += 1;
    } catch (error) {
      message = error.message;
    }
    results.push({ row: i, full_name: fullName, cccd_number: cccdNumber, result: message === 'Thành công' ? 'OK' : 'LỖI', message });
  }
  res.json({ message: `Import xong: ${success}/${results.length} dòng thành công.`, summary: { total: results.length, success, failed: results.length - success }, results });
}));

app.get('/api/logs', requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`SELECT l.id, l.action, l.old_status, l.new_status, l.note, l.created_at, u.full_name AS user_name, i.full_name AS worker_name FROM interview_logs l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN interview_forms i ON i.id = l.form_id ORDER BY l.id DESC LIMIT 200`);
  res.json({ logs: rows });
}));

app.get('/api/app-config', requireAuth, asyncHandler(async (req, res) => {
  const me = await getCurrentUser(req.session.user.id);
  const departments = (await pool.query(`SELECT id, name FROM departments ORDER BY name`)).rows;
  const companies = (await pool.query(`SELECT id, name, code FROM companies ORDER BY name`)).rows;
  res.json({ me, departments, companies });
}));

app.get(['/','/login','/app'], (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || 'Có lỗi xảy ra.' });
});

initDb().then(() => {
  app.listen(PORT, HOST, () => console.log(`Server đang chạy tại http://${HOST}:${PORT}`));
}).catch((error) => {
  console.error('Không khởi động được server:', error);
  process.exit(1);
});
