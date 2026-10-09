require('dotenv').config();
const {Pool}=require('pg');
const email=String(process.argv[2]||'').trim().toLowerCase();
(async()=>{
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Usage: npm run admin:promote -- staff@example.com');
  if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL in .env first.');
  const ssl=process.env.DATABASE_SSL==='disable'?false:process.env.NODE_ENV==='production'?{rejectUnauthorized:true}:undefined;
  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl});
  try{const {rowCount}=await pool.query('UPDATE users SET is_admin=true,updated_at=now() WHERE email=$1',[email]);if(!rowCount)throw new Error('No registered account has that email. Register the staff account first.');process.stdout.write('Staff access enabled. Refresh /dashboard/workspace to load the admin requests menu.\n');}
  finally{await pool.end();}
})().catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
