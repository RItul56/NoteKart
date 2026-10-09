const apiBase=location.port==='5500'?`${location.protocol}//${location.hostname}:3000`:'';
const form=document.querySelector('#admin-login-form'),notice=document.querySelector('#admin-login-notice');
document.querySelectorAll('a[href="/"]').forEach(link=>link.href=`${apiBase}/`);
const registerLink=document.querySelector('.admin-register-link a');if(registerLink&&apiBase)registerLink.href=`${apiBase}/admin/register`;
form.addEventListener('submit',async event=>{
  event.preventDefault();const button=form.querySelector('button');button.disabled=true;notice.textContent='Signing in…';notice.style.color='';
  try{const response=await fetch(`${apiBase}/api/admin/login`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'Could not sign in.');location.assign(`${apiBase}/dashboard/admin`)}
  catch(error){notice.textContent=error.message;notice.style.color='#a22d38';button.disabled=false}
});
