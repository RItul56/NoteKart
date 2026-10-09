const apiBase=location.port==='5500'?`${location.protocol}//${location.hostname}:3000`:'';
const form=document.querySelector('#admin-register-form');
const notice=document.querySelector('#admin-register-notice');
document.querySelectorAll('a[href="/"]').forEach(link=>link.href=`${apiBase}/`);
document.querySelectorAll('a[href="/admin/login"]').forEach(link=>link.href=`${apiBase}/admin/login`);
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=form.querySelector('button');
  const values=Object.fromEntries(new FormData(form));
  if(values.password!==values.confirmPassword){notice.textContent='Passwords do not match.';notice.style.color='#a22d38';return;}
  button.disabled=true;notice.textContent='Creating admin account…';notice.style.color='';
  try{
    const response=await fetch(`${apiBase}/api/admin/register`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.error||'Could not create the admin account.');
    notice.textContent=data.message||'Admin account created.';
    location.assign(`${apiBase}/dashboard/admin`);
  }catch(error){notice.textContent=error.message;notice.style.color='#a22d38';button.disabled=false;}
});
