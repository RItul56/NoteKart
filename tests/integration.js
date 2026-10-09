require('dotenv').config();
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

const base = process.env.APP_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const email = `notekart-smoke-${crypto.randomUUID()}@example.invalid`;
const password = `Smoke-${crypto.randomBytes(18).toString('hex')}`;
let userId, secondUserId, orderId, filePath;
let cookie = '', csrf = '';
const assertStatus = (response, expected, label) => assert.equal(response.status, expected, `${label}: expected HTTP ${expected}, got ${response.status}`);
async function json(response) { return response.json(); }
async function loginAs(emailValue, passwordValue) {
  const response = await fetch(`${base}/api/auth/login`, { method:'POST', headers:{'Content-Type':'application/json','Origin':base}, body:JSON.stringify({email:emailValue,password:passwordValue}) });
  const body = await json(response);
  if (response.ok) { cookie=response.headers.get('set-cookie')?.split(';')[0] || ''; csrf=body.csrf; }
  return {response,body};
}
async function request(url, options={}) {
  const headers=new Headers(options.headers || {});
  if(cookie)headers.set('Cookie',cookie);
  if(csrf)headers.set('X-CSRF-Token',csrf);
  headers.set('Origin',base);
  return fetch(`${base}${url}`,{...options,headers});
}
async function cleanup() {
  if(orderId) {
    const {rows}=await pool.query('SELECT file_path FROM submitted_files WHERE order_id=$1',[orderId]).catch(()=>({rows:[]}));
    filePath=rows[0]?.file_path || filePath;
    await pool.query('DELETE FROM payments WHERE order_id=$1',[orderId]).catch(()=>{});
    await pool.query('DELETE FROM receipts WHERE order_id=$1',[orderId]).catch(()=>{});
    await pool.query('DELETE FROM submitted_files WHERE order_id=$1',[orderId]).catch(()=>{});
    await pool.query('DELETE FROM orders WHERE id=$1',[orderId]).catch(()=>{});
  }
  if(userId)await pool.query('DELETE FROM users WHERE id=$1',[userId]).catch(()=>{});
  if(secondUserId)await pool.query('DELETE FROM users WHERE id=$1',[secondUserId]).catch(()=>{});
  if(filePath)await fs.unlink(path.isAbsolute(filePath)?filePath:path.join(__dirname,'..','storage','uploads',filePath)).catch(()=>{});
}

(async()=>{
  if(process.env.NODE_ENV==='production')throw new Error('Integration checks refuse to run with NODE_ENV=production.');
  assert.match(base,/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,'Run these checks only against the local NoteKart server.');
  assert.ok(process.env.DATABASE_URL,'DATABASE_URL is required.');
  const health=await fetch(`${base}/api/health`);assertStatus(health,200,'health');
  const home=await fetch(`${base}/`);assertStatus(home,200,'homepage');assert.match(await home.text(),/css\/style\.css/);
  const css=await fetch(`${base}/css/style.css`);assertStatus(css,200,'stylesheet');assert.match(css.headers.get('content-type'),/text\/css/);
  assertStatus(await fetch(`${base}/css/admin.css`),200,'staff stylesheet');
  const locationResponse=await fetch(`${base}/api/locations`);assertStatus(locationResponse,200,'locations');const locations=await json(locationResponse);assert.ok(locations.some(l=>l.name==='Bhopal'));
  const config=await json(await fetch(`${base}/api/config`));assert.equal(typeof config.razorpayEnabled,'boolean');assert.ok(!Object.keys(config).some(k=>k.toLowerCase().includes('secret')));

  const registered=await fetch(`${base}/api/auth/register`,{method:'POST',headers:{'Content-Type':'application/json','Origin':base},body:JSON.stringify({fullName:'NoteKart Smoke User',email,contactNumber:'+919876543210',collegeName:'Test College',courseName:'B.Tech',branchName:'Computer Science',academicYear:'2025-2026',semester:'Semester 4',section:'CS-A',enrollmentNumber:'NK-TEST-01',password,confirmPassword:password})});
  assertStatus(registered,201,'registration');assert.match((await json(registered)).message,/created successfully/i);
  assertStatus(await fetch(`${base}/api/auth/register`,{method:'POST',headers:{'Content-Type':'application/json','Origin':base},body:JSON.stringify({fullName:'NoteKart Smoke User',email,contactNumber:'+919876543210',collegeName:'Test College',courseName:'B.Tech',branchName:'Computer Science',academicYear:'2025-2026',semester:'Semester 4',section:'CS-A',enrollmentNumber:'NK-TEST-01',password,confirmPassword:password})}),409,'duplicate email registration');
  const storedHash=await pool.query('SELECT password_hash FROM users WHERE email=$1',[email]);assert.match(storedHash.rows[0].password_hash,/^\$argon2id\$/);assert.ok(!storedHash.rows[0].password_hash.includes(password));
  const wrong=await loginAs(email,`${password}-wrong`);assertStatus(wrong.response,401,'generic bad-password login');
  const loggedIn=await loginAs(email,password);assertStatus(loggedIn.response,200,'login');assert.match(loggedIn.response.headers.get('set-cookie'),/HttpOnly/i);assert.match(loggedIn.response.headers.get('set-cookie'),/SameSite=Lax/i);
  const me=await request('/api/auth/me');assertStatus(me,200,'session profile');const profile=await json(me);userId=profile.user.id;assert.equal(profile.user.email,email);assert.equal(profile.user.is_admin,false);assert.equal(profile.user.college_name,'Test College');assert.equal(profile.user.enrollment_number,'NK-TEST-01');

  const locations2=await json(await request('/api/locations'));const location=locations2.find(l=>l.name==='Bhopal');assert.ok(location);
  const form=new FormData();
  const pdf=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
  form.set('workFile',new Blob([pdf],{type:'application/pdf'}),'practical.pdf');
  for(const [k,v] of Object.entries({clientName:'Smoke Client',contactNumber:'+919876543210',collegeName:'Test College',section:'CS-A',enrollmentNumber:'NK-TEST-01',workType:'Practical',pageCount:'8',locationId:location.id,paymentMethod:'COD',additionalInstructions:'Integration check',final_amount:'0.01'}))form.set(k,v);
  const idempotencyKey=crypto.randomUUID();
  const rejectedFile=new FormData();for(const [key,value] of form.entries())rejectedFile.append(key,value);rejectedFile.set('workFile',new Blob(['MZ fake executable'],{type:'application/pdf'}),'bad.pdf');
  assertStatus(await request('/api/orders',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:rejectedFile}),400,'bad PDF signature');
  const executableForm=new FormData();for(const [key,value] of form.entries())executableForm.append(key,value);executableForm.set('workFile',new Blob(['MZ executable'],{type:'application/octet-stream'}),'payload.exe');
  assertStatus(await request('/api/orders',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:executableForm}),400,'executable upload rejection');
  const duplicateForm=new FormData();for(const [key,value] of form.entries())duplicateForm.append(key,value);
  const submissions=await Promise.all([request('/api/orders',{method:'POST',headers:{'Idempotency-Key':idempotencyKey},body:form}),request('/api/orders',{method:'POST',headers:{'Idempotency-Key':idempotencyKey},body:duplicateForm})]);
  assert.deepEqual(submissions.map(r=>r.status).sort(),[200,201],'simultaneous duplicate submissions create only one order');
  const ordersReturned=await Promise.all(submissions.map(json));orderId=ordersReturned[0].orderId;assert.equal(ordersReturned[1].orderId,orderId);assert.ok(ordersReturned.every(o=>o.paymentStatus==='PENDING'));
  const orderRow=await pool.query('SELECT final_amount,payment_status,college_name,course_name,section,enrollment_number FROM orders WHERE id=$1',[orderId]);assert.equal(orderRow.rows[0].final_amount,null,'browser-supplied amount must be ignored');assert.equal(orderRow.rows[0].college_name,'Test College');assert.equal(orderRow.rows[0].course_name,'B.Tech');assert.equal(orderRow.rows[0].enrollment_number,'NK-TEST-01');
  assert.equal((await json(await request('/api/orders'))).length,1,'user order history');
  const privateOrder=await json(await request(`/api/orders/${orderId}`));assert.equal(privateOrder.file_path,undefined,'filesystem path is never exposed');assert.equal(privateOrder.idempotency_key,undefined,'replay key is never exposed');
  const fileDownload=await request(`/api/orders/${orderId}/file`);assertStatus(fileDownload,200,'owned file download');
  const pdfReceipt=await request(`/api/orders/${orderId}/receipt?download=1`);assertStatus(pdfReceipt,200,'receipt download');assert.match(pdfReceipt.headers.get('content-type'),/application\/pdf/);
  const wrongOrigin=await fetch(`${base}/api/auth/register`,{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://attacker.example'},body:'{}'});assertStatus(wrongOrigin,403,'origin protection');
  const missingCsrf=await fetch(`${base}/api/auth/logout`,{method:'POST',headers:{Cookie:cookie,Origin:base}});assertStatus(missingCsrf,403,'CSRF protection');
  const unavailablePay=await request('/api/payments/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId})});assertStatus(unavailablePay,409,'COD cannot start online payment');
  const fakeVerify=await request('/api/payments/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({razorpay_order_id:'browser-controlled',razorpay_payment_id:'fake',razorpay_signature:'00'.repeat(32)})});assertStatus(fakeVerify,400,'browser cannot self-confirm payment');
  const unauthAdmin=await request('/api/admin/orders');assertStatus(unauthAdmin,403,'student cannot access staff order desk');

  const secondEmail=`notekart-smoke-${crypto.randomUUID()}@example.invalid`,secondPassword=`Smoke-${crypto.randomBytes(18).toString('hex')}`;
  const secondReg=await fetch(`${base}/api/auth/register`,{method:'POST',headers:{'Content-Type':'application/json','Origin':base},body:JSON.stringify({fullName:'Second Smoke User',email:secondEmail,contactNumber:'+919876543211',collegeName:'Test College',courseName:'B.Tech',branchName:'Computer Science',academicYear:'2025-2026',semester:'Semester 4',section:'CS-A',enrollmentNumber:'NK-TEST-02',password:secondPassword,confirmPassword:secondPassword})});assertStatus(secondReg,201,'second registration');
  const secondLogin=await loginAs(secondEmail,secondPassword);assertStatus(secondLogin.response,200,'second login');secondUserId=(await json(await request('/api/auth/me'))).user.id;
  assertStatus(await request(`/api/orders/${orderId}`),404,'IDOR order protection');assertStatus(await request(`/api/orders/${orderId}/file`),404,'IDOR file protection');
  const ownerLogin=await loginAs(email,password);assertStatus(ownerLogin.response,200,'owner re-login');

  await pool.query('UPDATE users SET is_admin=true WHERE id=$1',[userId]);
  const adminMe=await json(await request('/api/auth/me'));assert.equal(adminMe.user.is_admin,true);
  const staffOrders=await request('/api/admin/orders');assertStatus(staffOrders,200,'admin order desk');assert.ok((await json(staffOrders)).some(o=>o.id===orderId));
  assertStatus(await request(`/api/admin/orders/${orderId}/file`),200,'staff file download');
  const quote=await request(`/api/admin/orders/${orderId}/quote`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:'125.50'})});assertStatus(quote,200,'operator quote');
  const invalidTransition=await request(`/api/admin/orders/${orderId}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'completed'})});assertStatus(invalidTransition,409,'invalid status transition rejected');
  const confirmFromQuote=await request(`/api/admin/orders/${orderId}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'confirmed'})});assertStatus(confirmFromQuote,200,'order status transition');
  const receiptHtml=await request(`/api/orders/${orderId}/receipt`);assertStatus(receiptHtml,200,'view receipt');assert.match(await receiptHtml.text(),/125\.50/);
  process.stdout.write('PASS homepage and stylesheet\nPASS location and Bhopal\nPASS registration, bad-password rejection, and session login\nPASS file signature rejection, secure upload, COD order, and idempotency\nPASS amount tampering ignored, private file/receipt access, and CSRF/origin checks\nPASS admin quoting, payment gating, and valid order status changes\n');
})().catch(error=>{process.stderr.write(`FAIL: ${error.stack||error.message}\n`);process.exitCode=1;}).finally(async()=>{await cleanup();await pool.end();});
