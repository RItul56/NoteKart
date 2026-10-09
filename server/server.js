require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const argon2 = require('argon2');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const Razorpay = require('razorpay');
const { rateLimit } = require('express-rate-limit');
const storage = require('./services/storage');

const app = express();
const databaseSsl = process.env.DATABASE_SSL === 'disable' ? false : process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl, max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
const configuredUploadMb=Number(process.env.MAX_UPLOAD_MB||15);
const maxBytes=(Number.isFinite(configuredUploadMb)&&configuredUploadMb>0?Math.min(configuredUploadMb,25):15)*1024*1024;
const allowed = new Map([['pdf','application/pdf'],['doc','application/msword'],['docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['jpg','image/jpeg'],['jpeg','image/jpeg'],['png','image/png']]);
function isDocxPackage(buffer) {
  const signature=Buffer.from([0x50,0x4b,0x01,0x02]); let offset=0,contentTypes=false,documentXml=false;
  while((offset=buffer.indexOf(signature,offset))!==-1) {
    if(offset+46>buffer.length) return false;
    const nameLength=buffer.readUInt16LE(offset+28),extraLength=buffer.readUInt16LE(offset+30),commentLength=buffer.readUInt16LE(offset+32),end=offset+46+nameLength+extraLength+commentLength;
    if(end>buffer.length) return false;
    const name=buffer.toString('utf8',offset+46,offset+46+nameLength);
    if(name==='[Content_Types].xml') contentTypes=true;
    if(name==='word/document.xml') documentXml=true;
    if(name==='word/vbaProject.bin'||name.startsWith('../')||name.includes('/../')) return false;
    offset=end;
    if(contentTypes&&documentXml) return true;
  }
  return false;
}

app.disable('x-powered-by');
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
pool.on('error',err=>console.error('Idle PostgreSQL client error:',err.message));
const devOrigins = process.env.NODE_ENV === 'production' ? [] : ['http://127.0.0.1:5500','http://localhost:5500','http://127.0.0.1:3000','http://localhost:3000'];
const trustedOrigins = new Set([process.env.APP_ORIGIN,...devOrigins].filter(Boolean));
const connectSources = ["'self'",'https://api.razorpay.com'];
if (process.env.NODE_ENV !== 'production') connectSources.push('http://127.0.0.1:3000','http://localhost:3000');
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc:["'self'"], styleSrc:["'self'","'unsafe-inline'",'https://fonts.googleapis.com'], fontSrc:["'self'",'https://fonts.gstatic.com'], scriptSrc:["'self'",'https://checkout.razorpay.com','https://cdnjs.cloudflare.com'], connectSrc:connectSources, frameSrc:["'self'",'blob:','https://api.razorpay.com','https://checkout.razorpay.com'], imgSrc:["'self'",'data:','blob:'], objectSrc:["'none'"], frameAncestors:["'none'"] } } }));
app.use((req,res,next)=>{
  const origin=req.get('Origin');
  if(origin&&trustedOrigins.has(origin)){
    res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Access-Control-Allow-Credentials','true');
    res.setHeader('Vary','Origin');
    res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type, X-CSRF-Token, Idempotency-Key');
    if(req.method==='OPTIONS')return res.sendStatus(204);
  }
  next();
});
app.use(express.json({ limit: '30kb', verify: (req, _res, buf) => { if (req.originalUrl === '/api/payments/webhook') req.rawBody = Buffer.from(buf); } }));
app.use(express.urlencoded({ extended: false, limit: '30kb' }));
app.use(session({ store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }), name: 'notekart.sid', secret: process.env.SESSION_SECRET || 'development-only-change-me-to-a-long-random-secret', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000*60*60*8 } }));
const isLocalDevelopmentRequest=req=>process.env.NODE_ENV!=='production'&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.ip);
app.use('/api/auth', rateLimit({ windowMs: 15*60*1000, limit: 30, standardHeaders: true, legacyHeaders: false, skip:isLocalDevelopmentRequest }));
app.use('/api/orders', rateLimit({ windowMs: 60*60*1000, limit: 30, standardHeaders: true, legacyHeaders: false }));
app.use('/api/payments', rateLimit({ windowMs: 15*60*1000, limit: 12, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.resolve(__dirname, '..', 'public'), { index: 'index.html', dotfiles: 'deny' }));
app.get('/dashboard/workspace/',(req,res,next)=>req.path==='/dashboard/workspace/'?res.redirect(308,'/dashboard/workspace'):next());
app.get('/dashboard/css/style.css',(_req,res)=>res.sendFile(path.resolve(__dirname,'..','public','css','style.css')));
app.get('/dashboard/css/admin.css',(_req,res)=>res.sendFile(path.resolve(__dirname,'..','public','css','admin.css')));
app.get('/admin/css/style.css',(_req,res)=>res.sendFile(path.resolve(__dirname,'..','public','css','style.css')));
app.get('/admin/css/admin.css',(_req,res)=>res.sendFile(path.resolve(__dirname,'..','public','css','admin.css')));
app.get('/dashboard/js/main.js',(_req,res)=>res.sendFile(path.resolve(__dirname,'..','public','js','main.js')));
app.get('/dashboard/js/admin.js',(_req,res)=>res.sendFile(path.resolve(__dirname,'..','public','js','admin.js')));
app.get('/admin/js/admin-login.js',(_req,res)=>res.sendFile(path.resolve(__dirname,'..','public','js','admin-login.js')));
app.get('/admin/js/admin-register.js',(_req,res)=>res.sendFile(path.resolve(__dirname,'..','public','js','admin-register.js')));
app.get(['/dashboard','/dashboard/workspace'],(_req,res)=>res.sendFile(path.resolve(__dirname,'..','public','index.html')));

function cleanText(v, max=200) { return typeof v === 'string' ? v.trim().replace(/[\u0000-\u001f\u007f]/g,'').slice(0,max) : ''; }
function cleanAddress(v) { return typeof v==='string' ? v.replace(/\r\n?/g,'\n').split('\n').map(line=>line.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()).filter(Boolean).join(', ').slice(0,500) : ''; }
function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254; }
function csrf(req,res,next) {
  if (req.path === '/payments/webhook') return next();
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !trustedOrigins.has(origin)) return res.status(403).json({error:'Request not allowed.'});
  if (['/auth/login','/auth/register','/admin/login','/admin/register'].includes(req.path)) return next();
  if (!req.session.userId) return res.status(401).json({error:'Please log in.'});
  if (!req.session.csrf || req.get('x-csrf-token') !== req.session.csrf) return res.status(403).json({error:'Session token expired. Refresh and try again.'});
  next();
}
app.use('/api', csrf);
function auth(req,res,next) { if (!req.session.userId) return res.status(401).json({error:'Please log in.'}); next(); }
async function requireAdmin(req,res,next) {
  try { const {rows}=await pool.query('SELECT is_admin FROM users WHERE id=$1',[req.session.userId]); if(!rows[0]?.is_admin) return res.status(403).json({error:'Administrator access is required.'}); next(); }
  catch(e) { next(e); }
}
app.post('/api/admin/login',rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:true,legacyHeaders:false,skip:isLocalDevelopmentRequest}),async(req,res)=>{
  const email=cleanText(req.body.email,254).toLowerCase(),password=req.body.password;
  try {
    const {rows}=await pool.query('SELECT id,password_hash,is_admin FROM users WHERE email=$1',[email]);
    const valid=rows.length&&rows[0].is_admin&&typeof password==='string'&&await argon2.verify(rows[0].password_hash,password).catch(()=>false);
    if(!valid)return res.status(401).json({error:'Admin email or password is incorrect.'});
    await new Promise((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));
    req.session.userId=rows[0].id;req.session.csrf=crypto.randomBytes(32).toString('hex');
    res.json({message:'Admin signed in.',csrf:req.session.csrf});
  } catch(e) { apiError(e,req,res,()=>{}); }
});
app.post('/api/admin/register',rateLimit({windowMs:60*60*1000,limit:5,standardHeaders:true,legacyHeaders:false,skip:isLocalDevelopmentRequest}),async(req,res)=>{
  const full=cleanText(req.body.fullName,120),email=cleanText(req.body.email,254).toLowerCase(),phone=cleanText(req.body.contactNumber,30),password=req.body.password,key=req.body.registrationKey;
  if(full.length<2||!validEmail(email)||!/^[+0-9 ()-]{7,20}$/.test(phone)||typeof password!=='string'||password.length<10||password.length>128||password!==req.body.confirmPassword||typeof key!=='string'||key.length<32||key.length>256)return res.status(400).json({error:'Enter valid details, a password of at least 10 characters, and the admin setup key.'});
  const configuredKey=process.env.ADMIN_REGISTRATION_KEY;
  if(!configuredKey||configuredKey.length<32)return res.status(503).json({error:'Admin registration is disabled until ADMIN_REGISTRATION_KEY is configured on the server.'});
  const supplied=Buffer.from(key),expected=Buffer.from(configuredKey);
  if(supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected))return res.status(403).json({error:'Admin setup key is incorrect.'});
  let client;
  try{
    const passwordHash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
    client=await pool.connect();await client.query('BEGIN');
    const fingerprint=crypto.createHash('sha256').update(configuredKey).digest('hex');
    const reservation=await client.query('INSERT INTO admin_registration_key_uses(key_fingerprint) VALUES($1) ON CONFLICT DO NOTHING RETURNING key_fingerprint',[fingerprint]);
    if(!reservation.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'This admin setup key has already been used. Rotate ADMIN_REGISTRATION_KEY before another admin registration.'});}
    const created=await client.query('INSERT INTO users(full_name,email,contact_number,password_hash,is_admin) VALUES($1,$2,$3,$4,true) RETURNING id',[full,email,phone,passwordHash]);
    await client.query('COMMIT');
    await new Promise((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));req.session.userId=created.rows[0].id;req.session.csrf=crypto.randomBytes(32).toString('hex');
    res.status(201).json({message:'Admin account created. Opening the order desk.',csrf:req.session.csrf});
  }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});if(e.code==='23505')return res.status(409).json({error:'An account with that email already exists.'});apiError(e,req,res,()=>{});}
  finally{if(client)client.release();}
});
app.get('/dashboard/admin/',(req,res,next)=>req.path.endsWith('/')?res.redirect(308,'/dashboard/admin'):next());
app.get('/dashboard/admin',async(req,res,next)=>{
  if(!req.session.userId)return res.redirect('/admin/login');
  try {
    const {rows}=await pool.query('SELECT is_admin FROM users WHERE id=$1',[req.session.userId]);
    if(!rows[0]?.is_admin)return res.redirect('/dashboard/workspace?access=denied');
    res.sendFile(path.resolve(__dirname,'..','public','admin.html'));
  } catch(e) { next(e); }
});
app.get('/admin/login',(_req,res)=>res.sendFile(path.resolve(__dirname,'..','public','admin-login.html')));
app.get('/admin/register',(_req,res)=>res.sendFile(path.resolve(__dirname,'..','public','admin-register.html')));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1, fields: 15, parts: 16 }, fileFilter: (_req,file,cb) => {
  const ext = path.extname(file.originalname || '').slice(1).toLowerCase();
  cb(null, allowed.has(ext));
} });
const profilePhotoUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:1,parts:2},fileFilter:(_req,file,cb)=>cb(null,['image/jpeg','image/png','image/webp'].includes(file.mimetype))});
function apiError(err,req,res,next) {
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({error: err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the upload limit.' : 'Invalid file upload.'});
  if (err.type === 'entity.parse.failed') return res.status(400).json({error:'Invalid request body.'});
  if (err.type === 'entity.too.large') return res.status(413).json({error:'Request is too large.'});
  console.error(err);
  if (['ECONNREFUSED','ENOTFOUND','28P01','3D000'].includes(err.code) || (typeof err.code === 'string' && err.code.startsWith('08'))) return res.status(503).json({error:'NoteKart cannot connect to PostgreSQL. Set DATABASE_URL in .env and make sure the database is available.'});
  if (err.code === '42P01') return res.status(503).json({error:'The NoteKart database tables are missing. Apply database/schema.sql, then try again.'});
  res.status(500).json({error:'Something went wrong. Please try again.'});
}

app.get('/api/auth/me', (req,res) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex');
  if (!req.session.userId) return res.json({ user:null, csrf:req.session.csrf });
  pool.query('SELECT id,full_name,email,contact_number,college_name,course_name,branch_name,academic_year,semester,section,enrollment_number,is_admin,(profile_photo_key IS NOT NULL) AS has_profile_photo,updated_at FROM users WHERE id=$1',[req.session.userId]).then(({rows}) => res.json({user:rows[0] || null,csrf:req.session.csrf})).catch(e=>apiError(e,req,res,()=>{}));
});
app.post('/api/auth/register', async (req,res) => {
  const full=cleanText(req.body.fullName,120), email=cleanText(req.body.email,254).toLowerCase(), phone=cleanText(req.body.contactNumber,30), password=req.body.password;
  const profile={collegeName:cleanText(req.body.collegeName,180),courseName:cleanText(req.body.courseName,120),branchName:cleanText(req.body.branchName,120),academicYear:cleanText(req.body.academicYear,20),semester:cleanText(req.body.semester,30),section:cleanText(req.body.section,60),enrollmentNumber:cleanText(req.body.enrollmentNumber,80)};
  if (full.length<2 || !validEmail(email) || !/^\+?[0-9 ()-]{7,20}$/.test(phone) || Object.values(profile).some(v=>!v) || !/^\d{4}(?:-\d{4})?$/.test(profile.academicYear) || typeof password!=='string' || password.length<10 || password.length>128 || password!==req.body.confirmPassword) return res.status(400).json({error:'Complete your student details and use a password of at least 10 characters.'});
  try { const hash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1}); await pool.query('INSERT INTO users(full_name,email,contact_number,password_hash,college_name,course_name,branch_name,academic_year,semester,section,enrollment_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[full,email,phone,hash,profile.collegeName,profile.courseName,profile.branchName,profile.academicYear,profile.semester,profile.section,profile.enrollmentNumber]); res.status(201).json({message:'Account created successfully. Please log in.'}); }
  catch(e) { if(e.code==='23505') return res.status(409).json({error:'An account with that email already exists.'}); apiError(e,req,res,()=>{}); }
});
app.post('/api/auth/login', async (req,res) => {
  const email=cleanText(req.body.email,254).toLowerCase(), password=req.body.password;
  try { const {rows}=await pool.query('SELECT id,password_hash,is_admin FROM users WHERE email=$1',[email]); const ok=rows.length && typeof password==='string' && await argon2.verify(rows[0].password_hash,password).catch(()=>false); if(!ok) return res.status(401).json({error:'Email or password is incorrect.'}); await new Promise((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve())); req.session.userId=rows[0].id; req.session.csrf=crypto.randomBytes(32).toString('hex'); res.json({message:'Logged in.',csrf:req.session.csrf,isAdmin:rows[0].is_admin,redirectTo:rows[0].is_admin?'/dashboard/admin':'/dashboard/workspace'}); }
  catch(e) { apiError(e,req,res,()=>{}); }
});
app.patch('/api/auth/profile', auth, async (req,res,next) => {
  const full=cleanText(req.body.fullName,120),phone=cleanText(req.body.contactNumber,30),college=cleanText(req.body.collegeName,180),course=cleanText(req.body.courseName,120),branch=cleanText(req.body.branchName,120),year=cleanText(req.body.academicYear,20),semester=cleanText(req.body.semester,30),section=cleanText(req.body.section,60),enrollment=cleanText(req.body.enrollmentNumber,80);
  if(full.length<2||!/^\+?[0-9 ()-]{7,20}$/.test(phone)||![college,course,branch,year,semester,section,enrollment].every(Boolean)||!/^\d{4}(?:-\d{4})?$/.test(year))return res.status(400).json({error:'Complete all student profile details with valid values.'});
  try{const {rows}=await pool.query('UPDATE users SET full_name=$1,contact_number=$2,college_name=$3,course_name=$4,branch_name=$5,academic_year=$6,semester=$7,section=$8,enrollment_number=$9,updated_at=now() WHERE id=$10 RETURNING id,full_name,email,contact_number,college_name,course_name,branch_name,academic_year,semester,section,enrollment_number,is_admin,(profile_photo_key IS NOT NULL) AS has_profile_photo,updated_at',[full,phone,college,course,branch,year,semester,section,enrollment,req.session.userId]);if(!rows.length)return res.status(404).json({error:'Account not found.'});res.json({user:rows[0],message:'Profile saved. Future uploads will use these details.'});}catch(e){next(e);}
});
app.get('/api/auth/profile/photo',auth,async(req,res,next)=>{try{const {rows}=await pool.query('SELECT profile_photo_key FROM users WHERE id=$1',[req.session.userId]);if(!rows[0]?.profile_photo_key)return res.sendStatus(404);const key=rows[0].profile_photo_key,buffer=await storage.readBuffer(key),mime={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'}[path.extname(key).slice(1).toLowerCase()];res.setHeader('Content-Type',mime);res.setHeader('Cache-Control','private, max-age=300');res.setHeader('Cross-Origin-Resource-Policy','same-site');res.setHeader('X-Content-Type-Options','nosniff');res.send(buffer);}catch(e){if(e.code==='ENOENT')return res.sendStatus(404);next(e);}});
app.post('/api/auth/profile/photo',auth,profilePhotoUpload.single('profilePhoto'),async(req,res,next)=>{if(!req.file)return res.status(400).json({error:'Choose a JPG, PNG, or WebP image up to 5 MB.'});let newKey;try{const {fileTypeFromBuffer}=await import('file-type'),detected=await fileTypeFromBuffer(req.file.buffer);if(!detected||!['image/jpeg','image/png','image/webp'].includes(detected.mime)||detected.mime!==req.file.mimetype)return res.status(400).json({error:'The selected file is not a supported image.'});const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[detected.mime],previous=await pool.query('SELECT profile_photo_key FROM users WHERE id=$1',[req.session.userId]);if(!previous.rows.length)return res.status(404).json({error:'Account not found.'});newKey=`${crypto.randomUUID()}.${ext}`;await storage.storeBuffer(newKey,req.file.buffer);const {rows}=await pool.query('UPDATE users SET profile_photo_key=$1,updated_at=now() WHERE id=$2 RETURNING id,full_name,email,contact_number,college_name,course_name,branch_name,academic_year,semester,section,enrollment_number,is_admin,true AS has_profile_photo,updated_at',[newKey,req.session.userId]);if(!rows.length){await storage.removeObject(newKey).catch(()=>{});return res.status(404).json({error:'Account not found.'});}if(previous.rows[0].profile_photo_key)await storage.removeObject(previous.rows[0].profile_photo_key).catch(()=>{});res.json({user:rows[0],message:'Profile photo updated.'});}catch(e){if(newKey)await storage.removeObject(newKey).catch(()=>{});next(e);}});
app.post('/api/auth/logout', auth, (req,res) => req.session.destroy(e => { if(e) return res.status(500).json({error:'Could not log out.'}); res.clearCookie('notekart.sid'); res.json({message:'Logged out.'}); }));
app.get('/api/locations', async (_req,res,next) => { try { const {rows}=await pool.query('SELECT id,name FROM locations WHERE is_active=true ORDER BY name'); res.json(rows); } catch(e){next(e);} });
app.get('/api/config',(_req,res)=>res.json({razorpayEnabled:Boolean(process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET)}));
app.get('/api/health',async(_req,res,next)=>{try{await pool.query('SELECT 1');res.json({status:'ok'});}catch(e){next(e);}});
app.get('/api/admin/orders',auth,requireAdmin,async(req,res,next)=>{
  try { const status=cleanText(req.query.status,30),valid=['pending','reviewing','quoted','confirmed','in_progress','ready','delivered','completed','cancelled'];
    if(status&&!valid.includes(status))return res.status(400).json({error:'Unknown order status.'});
    const {rows}=await pool.query(`SELECT o.id,o.order_number,o.client_name,o.contact_number,o.delivery_address,o.college_name,o.course_name,o.branch_name,o.academic_year,o.semester,o.section,o.enrollment_number,o.work_type,o.page_count,o.additional_instructions,o.quoted_amount,o.delivery_fee,o.final_amount,o.order_status,o.payment_method,o.payment_status,o.created_at,l.name location_name,u.email customer_email,sf.original_filename,p.transaction_id AS payment_reference
      FROM orders o JOIN locations l ON l.id=o.location_id JOIN users u ON u.id=o.user_id LEFT JOIN submitted_files sf ON sf.order_id=o.id LEFT JOIN payments p ON p.order_id=o.id
      WHERE ($1='' OR o.order_status=$1) ORDER BY o.created_at DESC LIMIT 200`,[status]);res.json(rows);
  } catch(e){next(e);}
});
app.patch('/api/admin/orders/:id/quote',auth,requireAdmin,async(req,res,next)=>{
  let client;
  try {
    client=await pool.connect();await client.query('BEGIN');
    const found=await client.query(`SELECT id,page_count FROM orders WHERE id=$1 AND order_status IN ('pending','reviewing','quoted') AND payment_status<>'PAID' AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.order_id=orders.id AND p.transaction_id IS NOT NULL) FOR UPDATE`,[req.params.id]);
    if(!found.rows.length){await client.query('ROLLBACK');return res.status(404).json({error:'Order not found or it can no longer be quoted.'});}
    const order=found.rows[0],pageSubtotal=Number(order.page_count)*10,deliveryFee=pageSubtotal<150?40:0,total=pageSubtotal+deliveryFee;
    const {rows}=await client.query(`UPDATE orders SET quoted_amount=$1,delivery_fee=$2,final_amount=$3,order_status='quoted',payment_method='PENDING',delivery_address=NULL,payment_status='PENDING',updated_at=now() WHERE id=$4 RETURNING id,order_number,page_count,quoted_amount,delivery_fee,final_amount,payment_method`,[pageSubtotal,deliveryFee,total,order.id]);
    await client.query(`UPDATE payments SET payment_method='PENDING',amount=$1,gateway_order_id=NULL,transaction_id=NULL,payment_status='PENDING',gateway_response_reference=NULL,paid_at=NULL WHERE order_id=$2`,[total,rows[0].id]);await client.query('COMMIT');
    res.json({message:'Quote saved using ₹10 per page and delivery fee rules.',...rows[0]});
  } catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});next(e);}finally{if(client)client.release();}
});
app.patch('/api/admin/orders/:id/status',auth,requireAdmin,async(req,res,next)=>{
  try {const nextStatus=cleanText(req.body.status,30),{rows}=await pool.query('SELECT order_status FROM orders WHERE id=$1',[req.params.id]);if(!rows.length)return res.status(404).json({error:'Order not found.'});
    const transitions={pending:['reviewing','cancelled'],reviewing:['quoted','cancelled'],quoted:['confirmed','cancelled'],confirmed:['in_progress','cancelled'],in_progress:['ready','cancelled'],ready:['delivered'],delivered:['completed'],completed:[],cancelled:[]};
    if(!transitions[rows[0].order_status]?.includes(nextStatus))return res.status(409).json({error:`Cannot move an order from ${rows[0].order_status} to ${nextStatus}.`});
    const updated=await pool.query('UPDATE orders SET order_status=$1,updated_at=now() WHERE id=$2 AND order_status=$3',[nextStatus,req.params.id,rows[0].order_status]);if(!updated.rowCount)return res.status(409).json({error:'Another staff member changed this order. Refresh and try again.'});res.json({message:'Order status updated.',status:nextStatus});
  }catch(e){next(e);}
});
app.get('/api/admin/orders/:id/file',auth,requireAdmin,async(req,res,next)=>{try{const {rows}=await pool.query('SELECT sf.file_path,sf.original_filename FROM submitted_files sf JOIN orders o ON o.id=sf.order_id WHERE o.id=$1',[req.params.id]);if(!rows.length)return res.sendStatus(404);const file=rows[0],ext=path.extname(file.original_filename||'').toLowerCase();if(!['.pdf','.jpg','.jpeg','.png','.webp'].includes(ext)||req.query.download==='1')return storage.downloadResponse(res,file.file_path,file.original_filename);const bytes=await storage.readBuffer(file.file_path),mime=ext==='.pdf'?'application/pdf':ext==='.png'?'image/png':ext==='.webp'?'image/webp':'image/jpeg';res.setHeader('Content-Type',mime);res.setHeader('Content-Disposition',`inline; filename="${path.basename(file.original_filename).replace(/[\r\n"\\]/g,'_')}"`);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','private, no-store');res.send(bytes);}catch(e){next(e);}});

app.post('/api/orders', auth, upload.single('workFile'), async (req,res,next) => {
  let storedPath,idempotencyKey,client;
  try {
    client=await pool.connect();
    idempotencyKey=req.get('idempotency-key');
    if (!idempotencyKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) return res.status(400).json({error:'Refresh the form and try submitting again.'});
    const previous=await client.query('SELECT o.id,o.order_number,o.created_at,o.payment_method,o.payment_status,o.client_name,o.college_name,o.work_type,o.page_count,l.name location_name FROM orders o JOIN locations l ON l.id=o.location_id WHERE o.user_id=$1 AND o.idempotency_key=$2',[req.session.userId,idempotencyKey]);
    if(previous.rows.length) { const o=previous.rows[0]; return res.json({orderId:o.id,orderNumber:o.order_number,createdAt:o.created_at,paymentMethod:o.payment_method,paymentStatus:o.payment_status,client:o.client_name,college:o.college_name,work:o.work_type,pages:o.page_count,location:o.location_name,message:o.payment_method==='COD'?'Your order has been placed. Payment will be collected on delivery.':'Your order is submitted. Pay Now will be available after NoteKart confirms the quote.'}); }
    if (!req.file) return res.status(400).json({error:'Choose a PDF, DOC, DOCX, JPG, JPEG, or PNG file.'});
    const { fileTypeFromBuffer } = await import('file-type');
    const ext=path.extname(req.file.originalname).slice(1).toLowerCase(), detected=await fileTypeFromBuffer(req.file.buffer);
    const signatures={pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png'};
    const isDoc=ext==='doc' && req.file.buffer.length>=8 && req.file.buffer.subarray(0,8).equals(Buffer.from('D0CF11E0A1B11AE1','hex'));
    const isDocx=ext==='docx' && detected && (detected.mime==='application/zip' || detected.mime===allowed.get('docx')) && isDocxPackage(req.file.buffer);
    if ((signatures[ext] && (!detected || detected.mime!==signatures[ext])) || (ext==='doc'&&!isDoc) || (ext==='docx'&&!isDocx) || !allowed.has(ext)) return res.status(400).json({error:'The file content does not match an allowed document type.'});
    const {rows:profileRows}=await client.query('SELECT full_name,contact_number,college_name,course_name,branch_name,academic_year,semester,section,enrollment_number FROM users WHERE id=$1',[req.session.userId]);
    if(!profileRows.length)return res.status(401).json({error:'Your account could not be found. Please log in again.'});
    const student=profileRows[0];
    if(['full_name','contact_number','college_name','course_name','branch_name','academic_year','semester','section','enrollment_number'].some(key=>!String(student[key]||'').trim()))return res.status(409).json({error:'Complete your student profile before uploading. Open Student profile and save your college and academic details.'});
    const fields=['workType','locationId'];
    const data=Object.fromEntries(fields.map(k=>[k,cleanText(req.body[k],120)]));
    Object.assign(data,{clientName:student.full_name,contactNumber:student.contact_number,collegeName:student.college_name,courseName:student.course_name,branchName:student.branch_name,academicYear:student.academic_year,semester:student.semester,section:student.section,enrollmentNumber:student.enrollment_number});
    const pages=Number(req.body.pageCount);
    if (fields.some(k=>!data[k]) || !/^\+?[0-9 ()-]{7,20}$/.test(data.contactNumber) || !['Practical','Assignment','Project Work','Other'].includes(data.workType) || !Number.isInteger(pages)||pages<1||pages>1000) return res.status(400).json({error:'Complete all required fields with valid values.'});
    const instructions=cleanText(req.body.additionalInstructions,2000);
    const {rows:loc}=await client.query('SELECT id,name FROM locations WHERE id=$1 AND is_active=true',[data.locationId]); if(!loc.length) return res.status(400).json({error:'Choose an available service location.'});
    await client.query('BEGIN');
    const orderNo='NK-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(3).toString('hex').toUpperCase();
    const {rows}=await client.query(`INSERT INTO orders(order_number,user_id,idempotency_key,location_id,client_name,contact_number,college_name,course_name,branch_name,academic_year,semester,section,enrollment_number,work_type,page_count,additional_instructions,payment_method,payment_status,order_status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'PENDING','PENDING','pending') RETURNING id,order_number,created_at`,[orderNo,req.session.userId,idempotencyKey,data.locationId,data.clientName,data.contactNumber,data.collegeName,data.courseName,data.branchName,data.academicYear,data.semester,data.section,data.enrollmentNumber,data.workType,pages,instructions]);
    const order=rows[0], stored=`${crypto.randomUUID()}.${ext}`; storedPath=stored; await storage.storeBuffer(stored,req.file.buffer);
    await client.query('INSERT INTO submitted_files(order_id,original_filename,stored_filename,file_path,file_type,file_size) VALUES($1,$2,$3,$4,$5,$6)',[order.id,cleanText(path.basename(req.file.originalname),180),stored,stored,detected?.mime || allowed.get(ext),req.file.size]);
    await client.query('INSERT INTO payments(order_id,payment_method,payment_status) VALUES($1,$2,$3)',[order.id,'PENDING','PENDING']);
    const receiptNo='NKR-'+orderNo.slice(3); await client.query('INSERT INTO receipts(order_id,receipt_number) VALUES($1,$2)',[order.id,receiptNo]);
    await client.query('COMMIT');
    sendOrderEmail(order.id).catch(e=>console.error('Order email delivery failed:',e.message));
    res.status(201).json({orderId:order.id,orderNumber:order.order_number,createdAt:order.created_at,paymentMethod:'PENDING',paymentStatus:'PENDING',client:data.clientName,college:data.collegeName,work:data.workType,pages,location:loc[0].name,message:'Your order is submitted. Choose COD or UPI after NoteKart confirms the quote.'});
  } catch(e) {
    if(client)await client.query('ROLLBACK').catch(()=>{});
    if(storedPath)await storage.removeObject(storedPath).catch(()=>{});
    if(e.code==='23505'&&idempotencyKey){
      try {const {rows}=await pool.query('SELECT o.id,o.order_number,o.created_at,o.payment_method,o.payment_status,o.client_name,o.college_name,o.work_type,o.page_count,l.name location_name FROM orders o JOIN locations l ON l.id=o.location_id WHERE o.user_id=$1 AND o.idempotency_key=$2',[req.session.userId,idempotencyKey]);if(rows[0])return res.json({orderId:rows[0].id,orderNumber:rows[0].order_number,createdAt:rows[0].created_at,paymentMethod:rows[0].payment_method,paymentStatus:rows[0].payment_status,client:rows[0].client_name,college:rows[0].college_name,work:rows[0].work_type,pages:rows[0].page_count,location:rows[0].location_name,message:rows[0].payment_method==='COD'?'Your order has been placed. Payment will be collected on delivery.':'Your order is submitted. Pay Now will be available after NoteKart confirms the quote.'});}catch{}
    }
    next(e);
  }
  finally { if(client)client.release(); }
});

async function ownedOrder(userId,id) {
  const {rows}=await pool.query(`SELECT o.*,l.name AS location_name,sf.original_filename,sf.file_path,r.receipt_number,p.payment_gateway,p.transaction_id,p.amount AS payment_amount,p.currency,p.paid_at
    FROM orders o JOIN locations l ON l.id=o.location_id LEFT JOIN submitted_files sf ON sf.order_id=o.id LEFT JOIN receipts r ON r.order_id=o.id LEFT JOIN payments p ON p.order_id=o.id WHERE o.id=$1 AND o.user_id=$2`,[id,userId]); return rows[0];
}
app.get('/api/orders',auth,async(req,res,next)=>{try{const {rows}=await pool.query(`SELECT o.id,o.order_number,o.work_type,o.created_at,o.page_count,o.final_amount,o.payment_status,o.order_status,sf.original_filename FROM orders o LEFT JOIN submitted_files sf ON sf.order_id=o.id WHERE o.user_id=$1 ORDER BY o.created_at DESC LIMIT 200`,[req.session.userId]);res.json(rows);}catch(e){next(e);}});
app.delete('/api/orders/:id',auth,async(req,res,next)=>{let client;try{client=await pool.connect();await client.query('BEGIN');const {rows}=await client.query(`SELECT o.id,o.order_status,o.payment_status,o.final_amount,sf.file_path FROM orders o LEFT JOIN submitted_files sf ON sf.order_id=o.id WHERE o.id=$1 AND o.user_id=$2 FOR UPDATE OF o`,[req.params.id,req.session.userId]);if(!rows.length){await client.query('ROLLBACK');return res.status(404).json({error:'Upload not found.'});}const order=rows[0];if(order.order_status!=='pending'||order.payment_status!=='PENDING'||order.final_amount!==null){await client.query('ROLLBACK');return res.status(409).json({error:'This upload can no longer be deleted because it has been quoted, paid, or processing.'});}await client.query('DELETE FROM receipts WHERE order_id=$1',[order.id]);await client.query('DELETE FROM payments WHERE order_id=$1',[order.id]);await client.query('DELETE FROM submitted_files WHERE order_id=$1',[order.id]);await client.query('DELETE FROM orders WHERE id=$1',[order.id]);await client.query('COMMIT');if(order.file_path)await storage.removeObject(order.file_path).catch(e=>console.error('Could not remove deleted upload file:',e.message));res.json({message:'Upload and stored file deleted.'});}catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});next(e);}finally{if(client)client.release();}});
app.get('/api/orders/:id',auth,async(req,res,next)=>{try{const o=await ownedOrder(req.session.userId,req.params.id);if(!o)return res.status(404).json({error:'Order not found.'});const {file_path,idempotency_key,...safe}=o;res.json(safe);}catch(e){next(e);}});
app.post('/api/orders/:id/payment-method',auth,async(req,res,next)=>{
  const method=cleanText(req.body.method,10),deliveryAddress=cleanAddress(req.body.deliveryAddress);if(!['COD','UPI'].includes(method))return res.status(400).json({error:'Choose pay on delivery or UPI.'});if(method==='COD'&&(deliveryAddress.length<10||deliveryAddress.length>500))return res.status(400).json({error:'Enter a complete delivery address (10–500 characters) to use pay on delivery.'});
  let client;try{client=await pool.connect();await client.query('BEGIN');const {rows}=await client.query(`SELECT id,order_status,payment_status,final_amount FROM orders WHERE id=$1 AND user_id=$2 FOR UPDATE`,[req.params.id,req.session.userId]);
    if(!rows.length){await client.query('ROLLBACK');return res.sendStatus(404);}const order=rows[0];if(!['quoted','confirmed','in_progress','ready'].includes(order.order_status)||order.final_amount===null||order.payment_status==='PAID'){await client.query('ROLLBACK');return res.status(409).json({error:'Choose a payment option after the order quote is ready.'});}const {rows:payments}=await client.query('SELECT transaction_id FROM payments WHERE order_id=$1 FOR UPDATE',[order.id]);if(payments[0]?.transaction_id){await client.query('ROLLBACK');return res.status(409).json({error:'A UPI reference has already been submitted and cannot be changed.'});}
    await client.query(`UPDATE orders SET payment_method=$1,delivery_address=CASE WHEN $1='COD' THEN $2 ELSE NULL END,updated_at=now() WHERE id=$3`,[method,method==='COD'?deliveryAddress:null,order.id]);await client.query(`UPDATE payments SET payment_method=$1,amount=$2,payment_gateway=CASE WHEN $1='UPI' THEN 'upi_manual' ELSE NULL END,gateway_order_id=NULL,transaction_id=NULL,gateway_response_reference=NULL,payment_status='PENDING',paid_at=NULL WHERE order_id=$3`,[method,order.final_amount,order.id]);await client.query('COMMIT');res.json({message:method==='COD'?'Pay on delivery selected and delivery address saved.':'UPI selected. Scan the QR code and submit your payment reference for verification.',method});
  }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});next(e);}finally{if(client)client.release();}
});
app.post('/api/orders/:id/upi-reference',auth,async(req,res,next)=>{
  const reference=cleanText(req.body.reference,80);if(reference.length<6)return res.status(400).json({error:'Enter the UPI transaction reference shown by your payment app.'});
  try{const {rows}=await pool.query(`UPDATE payments p SET transaction_id=$1 WHERE p.order_id=$2 AND p.payment_method='UPI' AND p.payment_status='PENDING' AND EXISTS(SELECT 1 FROM orders o WHERE o.id=p.order_id AND o.user_id=$3 AND o.order_status IN ('quoted','confirmed','in_progress','ready') AND o.final_amount IS NOT NULL) RETURNING p.order_id`,[reference,req.params.id,req.session.userId]);if(!rows.length)return res.status(409).json({error:'This order is not waiting for a UPI payment reference.'});res.json({message:'Payment reference submitted. NoteKart will verify it before marking the order paid.'});}catch(e){next(e);}
});
app.patch('/api/admin/orders/:id/payment',auth,requireAdmin,async(req,res,next)=>{
  let client;try{client=await pool.connect();await client.query('BEGIN');const {rows}=await client.query(`UPDATE payments p SET payment_status='PAID',paid_at=now(),gateway_response_reference='manually_verified' FROM orders o WHERE p.order_id=o.id AND o.id=$1 AND p.payment_status='PENDING' AND ((p.payment_method='UPI' AND p.transaction_id IS NOT NULL) OR (p.payment_method='COD' AND o.order_status IN ('ready','delivered','completed'))) RETURNING p.order_id`,[req.params.id]);if(!rows.length){await client.query('ROLLBACK');return res.status(409).json({error:'Payment is not ready to verify. UPI orders need a submitted reference; COD can be recorded at delivery.'});}await client.query(`UPDATE orders SET payment_status='PAID',updated_at=now() WHERE id=$1`,[rows[0].order_id]);await client.query('COMMIT');res.json({message:'Payment marked received after manual verification.'});}catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});next(e);}finally{if(client)client.release();}
});
app.get('/api/orders/:id/file',auth,async(req,res,next)=>{try{const o=await ownedOrder(req.session.userId,req.params.id);if(!o)return res.sendStatus(404);const ext=path.extname(o.original_filename||'').toLowerCase(),inline=['.pdf','.jpg','.jpeg','.png','.webp'].includes(ext)&&req.query.download!=='1';if(!inline)return storage.downloadResponse(res,o.file_path,o.original_filename);const bytes=await storage.readBuffer(o.file_path),mime=ext==='.pdf'?'application/pdf':ext==='.png'?'image/png':ext==='.webp'?'image/webp':'image/jpeg';res.setHeader('Content-Type',mime);res.setHeader('Content-Disposition',`inline; filename="${path.basename(o.original_filename).replace(/[\r\n"\\]/g,'_')}"`);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','private, no-store');res.send(bytes);}catch(e){next(e);}});
app.get('/api/orders/:id/receipt',auth,async(req,res,next)=>{try{const o=await ownedOrder(req.session.userId,req.params.id);if(!o)return res.sendStatus(404);const pdf=req.query.download==='1';res.type(pdf?'application/pdf':'html');if(!pdf)return res.send(receiptHtml(o));res.setHeader('Content-Disposition',`attachment; filename="${o.receipt_number}.pdf"`);const doc=new PDFDocument({margin:54});doc.pipe(res);doc.fillColor('#102747').fontSize(25).text('NoteKart');doc.moveDown(.3).fontSize(16).text('Order Receipt');doc.moveDown();doc.fontSize(11).fillColor('#29384d');[['Receipt Number',o.receipt_number],['Order ID',o.order_number],['Order Date',new Date(o.created_at).toLocaleString('en-IN')],['Client Name',o.client_name],['Contact Number',o.contact_number],['College',o.college_name],['Section',o.section],['Enrollment Number',o.enrollment_number],['Location',o.location_name],['Work Type',o.work_type],['Page Count',o.page_count],['Page subtotal (@ ₹10/page)',o.quoted_amount==null?'₹'+(Number(o.page_count)*10):'₹'+o.quoted_amount],['Delivery fee','₹'+(o.final_amount==null?(Number(o.page_count)*10<150?40:0):Number(o.delivery_fee||0))],['Payment Method',o.payment_method],['Payment Status',o.payment_status],['Amount',o.final_amount==null?'Quote pending':`₹${o.final_amount}`]].forEach(([k,v])=>doc.text(`${k}: ${v}`));doc.moveDown().text('Thank you for choosing NoteKart.');doc.end();}catch(e){next(e);}});
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function receiptHtml(o){return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Receipt ${esc(o.receipt_number)}</title><link rel="stylesheet" href="/css/style.css"></head><body><main class="receipt"><p class="brand">NoteKart</p><h1>Order Receipt</h1><div class="receipt-grid">${[['Receipt Number',o.receipt_number],['Order ID',o.order_number],['Order Date',new Date(o.created_at).toLocaleString('en-IN')],['Client Name',o.client_name],['Contact Number',o.contact_number],['College',o.college_name],['Section',o.section],['Enrollment Number',o.enrollment_number],['Location',o.location_name],['Work Type',o.work_type],['Page Count',o.page_count],['Page subtotal (@ ₹10/page)',o.quoted_amount==null?'₹'+(Number(o.page_count)*10):'₹'+o.quoted_amount],['Delivery fee','₹'+(o.final_amount==null?(Number(o.page_count)*10<150?40:0):Number(o.delivery_fee||0))],['Payment Method',o.payment_method],['Payment Status',o.payment_status],['Amount',o.final_amount==null?'Quote pending':`₹${o.final_amount}`]].map(([a,b])=>`<div><small>${esc(a)}</small><strong>${esc(b)}</strong></div>`).join('')}</div><p>Thank you for choosing NoteKart.</p><a class="button" href="/api/orders/${encodeURIComponent(o.id)}/receipt?download=1">Download PDF</a></main></body></html>`;}
function mailTransport(){const port=Number(process.env.SMTP_PORT||587);return nodemailer.createTransport({host:process.env.SMTP_HOST,port,secure:port===465,requireTLS:port!==465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD},disableFileAccess:true,disableUrlAccess:true});}
async function sendOrderEmail(id){
  const smtpReady=process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASSWORD;
  const recipient=(process.env.NOTEKART_EMAIL||'ritulmastkar56@gmail.com').trim();
  if(!smtpReady){console.warn(`Order email not sent for ${id}: configure SMTP_HOST, SMTP_USER, and SMTP_PASSWORD.`);return;}
  const {rows}=await pool.query(`SELECT o.*,l.name location_name,u.email customer_email,sf.file_path,sf.original_filename,sf.file_size,sf.file_type,r.receipt_number FROM orders o JOIN locations l ON l.id=o.location_id JOIN users u ON u.id=o.user_id JOIN submitted_files sf ON sf.order_id=o.id JOIN receipts r ON r.order_id=o.id WHERE o.id=$1`,[id]);
  const o=rows[0];if(!o)return;
  const attachments=[];
  if(Number(o.file_size)<=10*1024*1024){const attachment=await storage.readBuffer(o.file_path);attachments.push({filename:o.original_filename,content:attachment,contentType:o.file_type,contentDisposition:'attachment'});}
  const amount=o.final_amount==null?'Quote pending':`₹${o.final_amount}`;
  const text=[
    'New NoteKart order received',
    `Order number: ${o.order_number}`,
    `Receipt number: ${o.receipt_number}`,
    `Submitted: ${new Date(o.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}`,
    `Order status: ${o.order_status}`,
    '',
    'STUDENT',
    `Name: ${o.client_name}`,
    `Account email: ${o.customer_email}`,
    `Contact number: ${o.contact_number}`,
    `College / university: ${o.college_name}`,
    `Course: ${o.course_name}`,
    `Branch / department: ${o.branch_name}`,
    `Academic year: ${o.academic_year}`,
    `Semester: ${o.semester}`,
    `Section: ${o.section}`,
    `Enrollment number: ${o.enrollment_number}`,
    '',
    'WORK REQUEST',
    `Service location: ${o.location_name}`,
    `Work type: ${o.work_type}`,
    `Approximate pages: ${o.page_count}`,
    `File: ${o.original_filename} (${(Number(o.file_size)/1024/1024).toFixed(2)} MB)`,
    `Payment method: ${o.payment_method}`,
    `Payment status: ${o.payment_status}`,
    `Quoted / final amount: ${amount}`,
    `Additional instructions: ${o.additional_instructions||'None'}`,
    attachments.length?'The submitted work file is attached.':`The file exceeds the 10 MB email attachment limit; download it from the protected NoteKart order desk.`
  ].join('\n');
  await mailTransport().sendMail({from:{name:'NoteKart',address:process.env.SMTP_USER},to:recipient,subject:`New NoteKart order ${o.order_number}`,text,attachments});
}

// Payment initialization is available only after a trusted operator sets a quote and final amount.
app.post('/api/payments/create',auth,async(req,res,next)=>{
  try {
    const id=cleanText(req.body.orderId,50),{rows}=await pool.query(`SELECT o.id,o.order_number,o.final_amount,o.payment_method,o.payment_status,p.gateway_order_id
      FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.id=$1 AND o.user_id=$2`,[id,req.session.userId]);
    const o=rows[0];if(!o)return res.sendStatus(404);
    if(o.payment_method!=='RAZORPAY'||o.payment_status==='PAID'||Number(o.final_amount)<=0||!process.env.RAZORPAY_KEY_ID||!process.env.RAZORPAY_KEY_SECRET)return res.status(409).json({error:'Online payment is not available for this order yet.'});
    const rz=new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET});
    const pay=o.payment_status==='PENDING'&&o.gateway_order_id?{id:o.gateway_order_id,amount:Math.round(Number(o.final_amount)*100),currency:'INR'}:await rz.orders.create({amount:Math.round(Number(o.final_amount)*100),currency:'INR',receipt:o.order_number});
    await pool.query(`UPDATE payments SET payment_gateway='razorpay',gateway_order_id=$1,transaction_id=NULL,amount=$2,payment_status='PENDING' WHERE order_id=$3`,[pay.id,o.final_amount,o.id]);
    res.json({keyId:process.env.RAZORPAY_KEY_ID,razorpayOrderId:pay.id,amount:pay.amount,currency:pay.currency});
  }catch(e){next(e);}
});
app.post('/api/payments/verify',auth,async(req,res,next)=>{
  try {
    const rid=cleanText(req.body.razorpay_order_id,100),pid=cleanText(req.body.razorpay_payment_id,100),sig=cleanText(req.body.razorpay_signature,200);
    if(!process.env.RAZORPAY_KEY_SECRET||!/^[a-f0-9]{64}$/i.test(sig))return res.status(400).json({error:'Payment verification failed.'});
    const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(`${rid}|${pid}`).digest('hex');
    if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(sig)))return res.status(400).json({error:'Payment verification failed.'});
    const {rows}=await pool.query(`SELECT o.id,o.final_amount FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.user_id=$1 AND p.gateway_order_id=$2`,[req.session.userId,rid]);
    if(!rows.length)return res.status(400).json({error:'Payment verification failed.'});
    const gatewayPayment=await new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET}).payments.fetch(pid);
    if(gatewayPayment.order_id!==rid||gatewayPayment.status!=='captured'||gatewayPayment.currency!=='INR'||gatewayPayment.amount!==Math.round(Number(rows[0].final_amount)*100))return res.status(409).json({error:'The gateway has not confirmed a captured payment yet.'});
    await pool.query(`UPDATE payments SET payment_status='PAID',transaction_id=$1,paid_at=now() WHERE order_id=$2`,[pid,rows[0].id]);
    await pool.query(`UPDATE orders SET payment_status='PAID',updated_at=now() WHERE id=$1`,[rows[0].id]);res.json({verified:true});
  }catch(e){next(e);}
});
app.post('/api/payments/webhook',async(req,res)=>{
  const sig=req.get('x-razorpay-signature');if(!sig||!process.env.RAZORPAY_WEBHOOK_SECRET||!req.rawBody)return res.sendStatus(400);
  const expected=crypto.createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(req.rawBody).digest('hex');
  if(!/^[a-f0-9]{64}$/i.test(sig)||!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(sig)))return res.sendStatus(400);
  try {
    const event=req.body;if(!['payment.captured','payment.failed'].includes(event.event))return res.json({received:true});
    const payment=event.payload.payment.entity,status=event.event==='payment.captured'?'PAID':'FAILED';
    if(payment.currency!=='INR'||!Number.isInteger(payment.amount))return res.sendStatus(400);
    const {rows}=await pool.query(`UPDATE payments p SET payment_status=$1,transaction_id=$2,paid_at=CASE WHEN $1='PAID' THEN now() ELSE paid_at END,gateway_response_reference=$3
      FROM orders o WHERE p.order_id=o.id AND p.gateway_order_id=$4 AND round(p.amount*100)=$5 AND (p.payment_status<>'PAID' OR $1='PAID') RETURNING p.order_id`,[status,payment.id,event.id,payment.order_id,payment.amount]);
    if(rows[0])await pool.query('UPDATE orders SET payment_status=$1,updated_at=now() WHERE id=$2',[status,rows[0].order_id]);
    res.json({received:true});
  }catch{return res.sendStatus(500);}
});

app.use((req,res)=>req.path.startsWith('/api/')?res.status(404).json({error:'Not found.'}):res.sendFile(path.join(__dirname,'..','public','index.html')));
app.use(apiError);
const port=Number(process.env.PORT||3000);
if(process.env.NODE_ENV==='production'){
  if(!process.env.SESSION_SECRET||process.env.SESSION_SECRET.length<32)throw new Error('SESSION_SECRET must be at least 32 characters in production.');
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required in production.');
  let origin;
  try{origin=new URL(process.env.APP_ORIGIN);}catch{throw new Error('APP_ORIGIN must be the exact HTTPS origin of the deployed site.');}
  if(origin.protocol!=='https:'||origin.origin!==process.env.APP_ORIGIN)throw new Error('APP_ORIGIN must be the exact HTTPS origin without a path or trailing slash.');
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be a valid TCP port.');
}
const server=app.listen(port,()=>console.log(`NoteKart listening on port ${port}`));
async function shutdown(){server.close(async()=>{await pool.end();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
