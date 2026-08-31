async function api(url, options={}) {
  const r = await fetch(url, {headers:{'Content-Type':'application/json', ...(options.headers||{})}, ...options});
  const d = await r.json().catch(()=>({error:'Unexpected server response'}));
  if(!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}
function msg(t,ok=false){
  const el=document.getElementById('msg');
  if(el){el.textContent=t;el.className='message '+(ok?'ok':'error');}
}

const loginForm=document.getElementById('loginForm');
if(loginForm) loginForm.addEventListener('submit',async e=>{
  e.preventDefault();
  const identifierEl=document.getElementById('identifier');
  const passwordEl=document.getElementById('password');
  try {
    await api('/api/auth/login',{method:'POST',body:JSON.stringify({identifier:identifierEl.value,password:passwordEl.value})});
    location='/';
  } catch(x) { msg(x.message); }
});

const registerForm=document.getElementById('registerForm');
if(registerForm) registerForm.addEventListener('submit',async e=>{
  e.preventDefault();
  const nameEl=document.getElementById('name');
  const usernameEl=document.getElementById('username');
  const emailEl=document.getElementById('email');
  const passwordEl=document.getElementById('password');
  const confirmEl=document.getElementById('confirm');
  if(passwordEl.value!==confirmEl.value) return msg('Passwords do not match.');
  try {
    await api('/api/auth/register',{method:'POST',body:JSON.stringify({name:nameEl.value,username:usernameEl.value,email:emailEl.value,password:passwordEl.value})});
    location='/';
  } catch(x) { msg(x.message); }
});

const forgotForm=document.getElementById('forgotForm');
if(forgotForm) forgotForm.addEventListener('submit',async e=>{
  e.preventDefault();
  const emailEl=document.getElementById('email');
  try {
    const d=await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email:emailEl.value})});
    msg(d.message,true);
  } catch(x) { msg(x.message); }
});

const resetForm=document.getElementById('resetForm');
if(resetForm) resetForm.addEventListener('submit',async e=>{
  e.preventDefault();
  const tokenEl=document.getElementById('token');
  const passwordEl=document.getElementById('password');
  try {
    await api('/api/auth/reset-password',{method:'POST',body:JSON.stringify({token:tokenEl.value,password:passwordEl.value})});
    msg('Password updated. You can now sign in.',true);
  } catch(x) { msg(x.message); }
});
