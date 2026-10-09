require('dotenv').config();
const fs=require('node:fs');
const path=require('node:path');
const {Client}=require('pg');

(async()=>{
  if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL in .env first.');
  const ssl=process.env.DATABASE_SSL==='disable'?false:process.env.NODE_ENV==='production'?{rejectUnauthorized:true}:undefined;
  const client=new Client({connectionString:process.env.DATABASE_URL,ssl});
  try{await client.connect();await client.query(fs.readFileSync(path.join(__dirname,'..','database','schema.sql'),'utf8'));process.stdout.write('NoteKart database schema is applied.\n');}
  finally{await client.end();}
})().catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
