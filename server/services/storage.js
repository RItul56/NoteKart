const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', 'storage', 'uploads');
function safeKey(key) {
  if(typeof key!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(pdf|doc|docx|jpg|jpeg|png|webp)$/i.test(key)) throw new Error('Invalid storage object key.');
  return key;
}
function resolveLocalPath(key) { return path.join(root,safeKey(key)); }
async function storeBuffer(key,buffer) {
  await fs.mkdir(root,{recursive:true});
  await fs.writeFile(resolveLocalPath(key),buffer,{flag:'wx',mode:0o600});
  return key;
}
async function readBuffer(key) { return fs.readFile(resolveLocalPath(key)); }
async function removeObject(key) { return fs.unlink(resolveLocalPath(key)); }
function downloadResponse(res,key,filename) { return res.download(resolveLocalPath(key),filename); }

module.exports={storeBuffer,readBuffer,removeObject,downloadResponse};
