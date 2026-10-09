const modal = document.querySelector('#modal');
const content = document.querySelector('#modal-content');
const toastEl = document.querySelector('#toast');
const workspaceRoot = document.querySelector('#workspace-root');
let csrfToken = null;
let currentUser = null;
let pendingOrderKey = null;
let pendingOrderForm = null;
let pendingPreviewUrl = null;
let myOrders = [];

const liveServerPreview = location.port === '5500' && ['127.0.0.1', 'localhost'].includes(location.hostname);
const apiBase = liveServerPreview ? `${location.protocol}//${location.hostname}:3000` : '';
document.querySelectorAll('a[href="/admin/login"]').forEach(link=>{if(apiBase)link.href=`${apiBase}/admin/login`});

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (csrfToken && options.method && options.method !== 'GET') headers.set('x-csrf-token', csrfToken);
  let response;
  try {
    response = await fetch(apiBase && url.startsWith('/api/') ? `${apiBase}${url}` : url, {
      credentials: apiBase ? 'include' : 'same-origin', ...options, headers
    });
  } catch {
    throw new Error(`Could not reach NoteKart's API at ${apiBase || location.origin}. Start the NoteKart server with npm start.`);
  }
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || data.message || (response.status === 429 ? 'Too many attempts. Please wait before trying again.' : `Request failed (${response.status}). Please try again.`));
  return data;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 3500);
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function escapeAttr(value) { return escapeHtml(value); }
function closeModal() {
  if (pendingPreviewUrl) { URL.revokeObjectURL(pendingPreviewUrl); pendingPreviewUrl = null; }
  pendingOrderForm = null;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}
function openModal(which) {
  if (which === 'submit' && !currentUser) which = 'login';
  if (which === 'submit' && !profileComplete()) {
    showWorkspaceView('profile');
    toast('Complete your student profile before uploading.');
    return;
  }
  const template = document.querySelector(`#${which}-template`);
  if (!template) { toast('Please log in to submit work.'); return; }
  content.replaceChildren(template.content.cloneNode(true));
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  if (which === 'submit') {
    pendingOrderKey = crypto.randomUUID();
    prefillOrderForm();
    loadLocations();
  }
}
function prefillOrderForm() {
  if (!currentUser) return;
  const form = document.querySelector('#order-form');
  if (!form) return;
  const mapping = {
    clientName:'full_name', contactNumber:'contact_number', collegeName:'college_name',
    courseName:'course_name', branchName:'branch_name', academicYear:'academic_year',
    semester:'semester', section:'section', enrollmentNumber:'enrollment_number'
  };
  for (const [fieldName, userKey] of Object.entries(mapping)) {
    const field = form.elements.namedItem(fieldName);
    if (field) field.value = currentUser[userKey] || '';
  }
}
async function loadLocations() {
  try {
    const [locations, config] = await Promise.all([api('/api/locations'), api('/api/config')]);
    const select = document.querySelector('#location-select');
    if (!select) return;
    select.innerHTML = '<option value="">Choose location</option>' + locations.map(l => `<option value="${escapeAttr(l.id)}">${escapeHtml(l.name)}</option>`).join('');
    if (!locations.length) select.innerHTML = '<option value="">No locations available</option>';
    if (!config.razorpayEnabled) {
      const option = document.querySelector('input[name="paymentMethod"][value="RAZORPAY"]');
      if (option) {
        option.disabled = true;
        option.closest('label').title = 'NoteKart online payments are not configured yet.';
        option.closest('label').style.opacity = '.55';
        const note = document.createElement('small');
        note.textContent = '(temporarily unavailable)';
        option.closest('label').append(note);
      }
    }
  } catch (error) { toast(`Could not load service options: ${error.message}`); }
}
function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}
function profileComplete() {
  return !!currentUser && ['full_name','contact_number','college_name','course_name','branch_name','academic_year','semester','section','enrollment_number'].every(k => String(currentUser[k] || '').trim());
}
function avatarMarkup(user) {
  const initials = escapeHtml(user.full_name.split(/\s+/).map(n => n[0]).slice(0, 2).join('').toUpperCase());
  const photoUrl = `${apiBase}/api/auth/profile/photo?v=${encodeURIComponent(user.updated_at || '')}`;
  return user.has_profile_photo
    ? `<img class="workspace-avatar photo" crossorigin="use-credentials" src="${photoUrl}" alt="${escapeAttr(user.full_name)} profile photo">`
    : `<span class="workspace-avatar">${initials}</span>`;
}
function updateNav(render = true) {
  const actions = document.querySelector('#nav-actions');
  if (currentUser) {
    document.body.classList.add('workspace-mode');
    if (actions) actions.innerHTML = `<span class="nav-user">${escapeHtml(currentUser.full_name)}</span><button class="button small" data-open="submit">+ New upload</button><button class="login-link" id="logout">Log out</button>`;
    if (render) renderWorkspace();
  } else {
    document.body.classList.remove('workspace-mode');
    if (workspaceRoot) workspaceRoot.hidden = true;
  }
}
function renderWorkspace() {
  if (!currentUser || !workspaceRoot) return;
  workspaceRoot.hidden = false;
  workspaceRoot.innerHTML = `<aside class="workspace-sidebar">
    <a class="brand" href="#workspace" data-workspace-view="overview"><span class="brand-mark">N</span>NoteKart</a>
    <div class="workspace-label">WORKSPACE</div>
    <button class="workspace-link active" data-workspace-view="overview"><span>⌂</span> Overview</button>
    <button class="workspace-link" data-workspace-view="orders"><span>▤</span> My uploads</button>
    <button class="workspace-link" data-workspace-view="profile"><span>◉</span> Student profile</button>
    <div class="sidebar-bottom"><div class="sidebar-help"><b>Need a hand?</b><small>We’re here to help with your order.</small><a href="mailto:help@notekart.in">Contact support ↗</a></div>
    <button class="workspace-link" id="workspace-logout"><span>↪</span> Log out</button></div>
    </aside><section class="workspace-main"><header class="workspace-topbar"><div class="workspace-breadcrumb">Workspace <span>/</span> <b id="workspace-section-title">Overview</b></div>
    <div class="workspace-top-actions"><span class="workspace-status"><i></i> Bhopal service</span>${avatarMarkup(currentUser)}</div></header>
    <div class="workspace-content" id="workspace-content"></div></section>`;
  showWorkspaceView('overview');
}
async function showWorkspaceView(view) {
  if (!currentUser || !workspaceRoot) return;
  const titles = { overview:'Overview', orders:'My uploads', profile:'Student profile', admin:'Admin requests' };
  workspaceRoot.querySelectorAll('.workspace-link[data-workspace-view]').forEach(button => button.classList.toggle('active', button.dataset.workspaceView === view));
  const title = workspaceRoot.querySelector('#workspace-section-title');
  if (title) title.textContent = titles[view] || 'Overview';
  const pane = workspaceRoot.querySelector('#workspace-content');
  if (!pane) return;
  if (view === 'profile') { renderProfile(pane); return; }
  if (view === 'admin') { await showAdminOrders(pane); return; }
  pane.innerHTML = '<div class="workspace-loading">Loading your workspace…</div>';
  try {
    const orders = await api('/api/orders');
    if (view === 'orders') {
      myOrders = orders;
      pane.innerHTML = `<div class="workspace-heading"><div><div class="eyebrow">YOUR WORKSPACE</div><h1>My uploads</h1><p>Follow each request from upload to delivery.</p></div>
        <div class="workspace-heading-actions"><button class="quiet-link" data-refresh-orders>Refresh uploads</button><button class="button" data-open="submit">＋ New upload</button>${profileComplete() ? '' : '<button class="quiet-link" data-workspace-view="profile">Complete profile</button>'}</div></div>
        ${profileComplete() ? '' : '<p class="profile-prefill">Complete your student profile before you upload a new file.</p>'}
        <div class="workspace-panel"><div class="panel-title"><div><h2>All uploads</h2><p>Your submitted practicals, assignments and projects.</p></div><span class="count-pill">${orders.length} total</span></div><label class="order-search">Find an upload by order ID<input id="order-search" type="search" placeholder="e.g. NK-MUYQS4DA-AF9650 or UUID"></label><div id="orders-results">${renderOrderRows(orders)}</div></div>`;
      return;
    }
    const active = orders.filter(o => !['completed','cancelled','delivered'].includes(o.order_status)).length;
    const done = orders.filter(o => ['completed','delivered'].includes(o.order_status)).length;
    pane.innerHTML = `<div class="workspace-heading"><div><div class="eyebrow">YOUR NOTEKART WORKSPACE</div><h1>Good ${greeting()}, ${escapeHtml(currentUser.full_name.split(' ')[0])} <span class="wave">✦</span></h1><p>Keep your college work moving. Start a new request or check on one you’ve already sent.</p></div>
      <div class="workspace-heading-actions"><button class="button" data-open="submit">＋ New upload</button>${profileComplete() ? '' : '<button class="quiet-link" data-workspace-view="profile">Complete profile</button>'}</div></div>
      ${profileComplete() ? '' : '<div class="profile-prefill">Complete your student profile once so NoteKart can prefill those details on every upload.</div>'}
      <div class="workspace-stats"><article class="stat-card"><span class="stat-icon violet">▤</span><small>Total uploads</small><strong>${orders.length}</strong><span>All your submitted work</span></article>
      <article class="stat-card"><span class="stat-icon mint">◷</span><small>In progress</small><strong>${active}</strong><span>Requests being handled</span></article>
      <article class="stat-card"><span class="stat-icon peach">✓</span><small>Completed</small><strong>${done}</strong><span>Delivered or completed</span></article></div>
      <div class="workspace-columns"><div class="workspace-panel recent-panel"><div class="panel-title"><div><h2>Recent uploads</h2><p>A quick look at your latest requests.</p></div><button class="quiet-link" data-workspace-view="orders">View all ↗</button></div>${renderOrderRows(orders.slice(0, 5))}</div>
      <aside class="workspace-panel profile-card"><div class="profile-card-head">${avatarMarkup(currentUser)}<div><h2>${escapeHtml(currentUser.full_name)}</h2><p>${escapeHtml(currentUser.college_name || 'Complete your student profile')}</p></div></div>
      <div class="profile-card-details"><div><small>Course & branch</small><b>${escapeHtml([currentUser.course_name,currentUser.branch_name].filter(Boolean).join(' · ') || 'Add your course')}</b></div>
      <div><small>Year · semester · section</small><b>${escapeHtml([currentUser.academic_year,currentUser.semester,currentUser.section].filter(Boolean).join(' · ') || 'Add your academic details')}</b></div></div>
      <button class="quiet-link" data-workspace-view="profile">View student profile ↗</button></aside></div>`;
  } catch (error) {
    pane.innerHTML = `<div class="workspace-error">${escapeHtml(error.message)} <button class="quiet-link" data-workspace-view="overview">Try again</button></div>`;
  }
}
function renderOrderRows(orders) {
  if (!orders.length) return '<div class="empty-workspace"><span>▤</span><h3>No uploads yet</h3><p>Your first request is just a few details away.</p><button class="button" data-open="submit">Upload your first file</button></div>';
  return `<div class="workspace-order-list">${orders.map(order => {
    const canDelete = order.order_status === 'pending' && order.payment_status === 'PENDING' && order.final_amount == null;
    return `<div class="workspace-order-entry"><button class="workspace-order-row" data-order-id="${escapeAttr(order.id)}">
      <span class="file-type-icon">${escapeHtml((order.work_type || 'W').slice(0, 1))}</span><span class="order-info"><b>${escapeHtml(order.order_number)}</b><small>${escapeHtml(order.original_filename || order.work_type)} · ${order.page_count ? `${order.page_count} pages · ` : ''}${new Date(order.created_at).toLocaleDateString()}</small></span>
      <span class="order-price">${order.final_amount == null ? 'Quote pending' : '₹' + escapeHtml(order.final_amount)}</span><span class="status-pill status-${escapeAttr(order.order_status)}">${escapeHtml(order.order_status.replaceAll('_', ' '))}</span><span class="row-arrow">›</span></button>
      ${canDelete ? `<button class="order-delete" type="button" data-delete-order="${escapeAttr(order.id)}" aria-label="Delete upload" title="Delete pending upload">Delete</button>` : ''}</div>`;
  }).join('')}</div>`;
}
async function showAdminOrders(pane, selectedStatus = '') {
  pane.innerHTML = '<div class="workspace-loading">Loading new requests…</div>';
  try {
    const query = selectedStatus ? `?status=${encodeURIComponent(selectedStatus)}` : '';
    const orders = await api(`/api/admin/orders${query}`);
    const statuses = ['pending','reviewing','quoted','confirmed','in_progress','ready','delivered','completed','cancelled'];
    pane.innerHTML = `<div class="workspace-heading"><div><div class="eyebrow">ORDER MANAGEMENT</div><h1>Admin requests</h1><p>Review new orders, open submitted files, issue quotes, and update progress.</p></div><button class="button" data-admin-refresh>Refresh requests</button></div>
      <div class="workspace-panel"><div class="admin-orders-toolbar"><div><h2>Requests</h2><p>${orders.length} request${orders.length === 1 ? '' : 's'} shown</p></div><label>Filter by status<select id="admin-status-filter"><option value="">All requests</option>${statuses.map(status => `<option value="${status}" ${status === selectedStatus ? 'selected' : ''}>${status.replaceAll('_',' ')}</option>`).join('')}</select></label></div>
      ${orders.length ? `<div class="admin-request-list">${orders.map(order => {
        const subtotal = Number(order.page_count) * 10;
        const delivery = Number(order.delivery_fee || (subtotal < 150 ? 40 : 0));
        const total = order.final_amount == null ? subtotal + (subtotal < 150 ? 40 : 0) : Number(order.final_amount);
        const actions = [];
        if (order.order_status === 'pending') actions.push(`<button class="quiet-link" data-admin-status="reviewing" data-order-id="${escapeAttr(order.id)}">Start review</button>`);
        if (['pending','reviewing','quoted'].includes(order.order_status) && order.payment_status !== 'PAID') actions.push(`<button class="button small" data-admin-quote="${escapeAttr(order.id)}">${order.final_amount == null ? 'Send quote' : 'Update quote'}</button>`);
        const nextStatus = { reviewing:'cancelled', quoted:'confirmed', confirmed:'in_progress', in_progress:'ready', ready:'delivered', delivered:'completed' }[order.order_status];
        if (nextStatus) actions.push(`<button class="quiet-link" data-admin-status="${nextStatus}" data-order-id="${escapeAttr(order.id)}">${nextStatus === 'cancelled' ? 'Cancel order' : 'Mark ' + nextStatus.replaceAll('_',' ')}</button>`);
        return `<article class="admin-request"><div class="admin-request-heading"><div><b>${escapeHtml(order.order_number)}</b><small>${new Date(order.created_at).toLocaleString()}</small></div><span class="status-pill status-${escapeAttr(order.order_status)}">${escapeHtml(order.order_status.replaceAll('_',' '))}</span></div>
          <div class="admin-request-details"><span><small>Student</small><b>${escapeHtml(order.client_name)}</b><small>${escapeHtml(order.customer_email)}</small></span><span><small>College / course</small><b>${escapeHtml(order.college_name)} · ${escapeHtml(order.course_name)}</b><small>${escapeHtml(order.work_type)} · ${order.page_count} pages</small></span><span><small>File</small><b>${escapeHtml(order.original_filename || 'No file attached')}</b><small>Order ID: ${escapeHtml(order.id)}</small></span><span><small>Quote estimate</small><b>₹${subtotal} + ₹${delivery} delivery = ₹${total}</b><small>${escapeHtml(order.payment_method)} · ${escapeHtml(order.payment_status)}</small></span></div>
          <div class="admin-request-actions">${order.original_filename ? `<a class="button small" target="_blank" rel="noopener" href="${apiBase}/api/admin/orders/${encodeURIComponent(order.id)}/file">Open submitted file</a><a class="quiet-link" href="${apiBase}/api/admin/orders/${encodeURIComponent(order.id)}/file?download=1">Download</a>` : ''}${actions.join('')}</div></article>`;
      }).join('')}</div>` : '<div class="empty-workspace"><span>▣</span><h3>No requests found</h3><p>New customer orders will appear here.</p></div>'}</div>`;
  } catch (error) {
    pane.innerHTML = `<div class="workspace-error">${escapeHtml(error.message)} Your account may not have admin access.</div>`;
  }
}
function renderProfile(pane) {
  if (!currentUser) return;
  pane.innerHTML = `<div class="workspace-heading"><div><div class="eyebrow">ACCOUNT DETAILS</div><h1>Student profile</h1><p>Keep these details up to date. New uploads will use your saved profile automatically.</p></div></div>
    <section class="workspace-panel profile-photo-panel"><div class="profile-photo-current" id="profile-photo-preview">${avatarMarkup(currentUser)}</div><div class="profile-photo-copy"><h2>Profile photo</h2><p>Upload a JPG, PNG, or WebP image (up to 5 MB). You can replace it any time.</p>
    <form id="photo-form"><label class="photo-picker">Choose image<input id="profile-photo-file" name="profilePhoto" type="file" accept="image/jpeg,image/png,image/webp" required></label><button class="button" type="submit">Save photo <span>↗</span></button></form></div></section>
    <form id="profile-form" class="workspace-panel profile-form"><div class="form-grid"><label>Full name<input name="fullName" value="${escapeAttr(currentUser.full_name)}" maxlength="120" required></label>
    <label>Email<input value="${escapeAttr(currentUser.email)}" readonly></label><label>Contact number<input name="contactNumber" value="${escapeAttr(currentUser.contact_number)}" required></label>
    <label>College / university<input name="collegeName" value="${escapeAttr(currentUser.college_name)}" maxlength="180" required></label><label>Course<input name="courseName" value="${escapeAttr(currentUser.course_name)}" required></label>
    <label>Branch / department<input name="branchName" value="${escapeAttr(currentUser.branch_name)}" required></label><label>Academic year<input name="academicYear" value="${escapeAttr(currentUser.academic_year)}" pattern="[0-9]{4}(-[0-9]{4})?" required></label>
    <label>Semester<input name="semester" value="${escapeAttr(currentUser.semester)}" required></label><label>Section<input name="section" value="${escapeAttr(currentUser.section)}" required></label>
    <label>Enrollment number<input name="enrollmentNumber" value="${escapeAttr(currentUser.enrollment_number)}" required></label></div><button class="button" type="submit">Save profile <span>↗</span></button></form>`;
}
function calculatePageQuote(pageCount) {
  const pageSubtotal = Number(pageCount) * 10;
  const deliveryFee = pageSubtotal < 150 ? 40 : 0;
  return { pageSubtotal, deliveryFee, total: pageSubtotal + deliveryFee };
}
function clearOrderPreview() {
  if (pendingPreviewUrl) { URL.revokeObjectURL(pendingPreviewUrl); pendingPreviewUrl = null; }
}
function showOrderReview(form) {
  pendingOrderForm = form;
  const file = form.elements.namedItem('workFile').files[0];
  const pageCount = Number(form.elements.namedItem('pageCount').value);
  if (!file || !pageCount) return toast('Choose a file and enter its page count first.');
  clearOrderPreview();
  pendingPreviewUrl = URL.createObjectURL(file);
  const { pageSubtotal, deliveryFee, total } = calculatePageQuote(pageCount);
  const fileType = file.type || '';
  const fileName = file.name.toLowerCase();
  const isPdf = fileType === 'application/pdf' || fileName.endsWith('.pdf');
  const isImage = fileType.startsWith('image/') || /\.(jpe?g|png)$/.test(fileName);
  const preview = isPdf
    ? `<iframe class="order-file-preview" src="${pendingPreviewUrl}" title="Review uploaded PDF"></iframe>`
    : isImage
      ? `<img class="order-image-preview" src="${pendingPreviewUrl}" alt="Preview of ${escapeAttr(file.name)}">`
      : `<p class="form-hint">Your browser cannot preview this Word document here. Open or download it to verify the contents. If it is wrong, go back and choose another file.</p><a class="button small" target="_blank" rel="noopener" href="${pendingPreviewUrl}">Open or download document</a>`;
  const locationSelect = form.elements.namedItem('locationId');
  const locationName = locationSelect?.selectedOptions?.[0]?.textContent || 'Not selected';
  form.hidden = true;
  content.querySelector('#modal-title').textContent = 'Review and confirm your order';
  const section = document.createElement('section');
  section.id = 'order-review';
  section.className = 'order-review';
  section.innerHTML = `<p>Check the uploaded file and total. If the file is wrong, go back and replace it before placing the order.</p>
    <div class="order-review-file"><b>${escapeHtml(file.name)}</b><small>${(file.size / 1024 / 1024).toFixed(2)} MB · ${pageCount} pages · ${escapeHtml(locationName)}</small></div>
    <div class="order-review-price"><div><span>Pages (${pageCount} × ₹10)</span><b>₹${pageSubtotal}</b></div><div><span>Delivery</span><b>₹${deliveryFee}</b></div><div class="order-review-total"><span>Estimated total · payment after quote</span><b>₹${total}</b></div></div>
    <div class="order-review-preview">${preview}</div>
    <div class="order-review-actions"><button class="quiet-link" type="button" data-back-order>← Back to edit details</button><button class="button" type="button" data-confirm-order>Place order · ₹${total}</button></div>`;
  form.after(section);
}
function openOrderConfirmation(order) {
  const quote = calculatePageQuote(order.pages);
  content.innerHTML = `<div class="modal-eyebrow">ORDER RECEIVED</div><h2 id="modal-title">🎉 Order submitted successfully!</h2><p>${escapeHtml(order.message)}</p>
    <div class="receipt-grid">${[['Order number',order.orderNumber],['Client',order.client],['College',order.college],['Work',order.work],['Pages',order.pages],['Pages subtotal','₹' + quote.pageSubtotal],['Delivery fee','₹' + quote.deliveryFee],['Estimated total','₹' + quote.total],['Location',order.location],['Payment','Choose after quote'],['Payment status',order.paymentStatus],['Minimum delivery','5–7 days']].map(([label,value]) => `<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>
    <a class="button full" href="${apiBase}/api/orders/${encodeURIComponent(order.orderId)}/receipt?download=1">Download receipt <span>↗</span></a>
    <p class="switch-form"><a target="_blank" rel="noopener" href="${apiBase}/api/orders/${encodeURIComponent(order.orderId)}/receipt">View receipt</a> · <a href="#orders" id="dashboard-orders">My uploads</a></p>`;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}
function orderDetailMarkup(order) {
  const estimatedFee = Number(order.page_count) * 10 < 150 ? 40 : 0;
  const delivery = order.final_amount == null ? estimatedFee : Number(order.delivery_fee || 0);
  const pageSubtotal = order.quoted_amount == null ? Number(order.page_count) * 10 : Number(order.quoted_amount);
  const total = order.final_amount == null ? pageSubtotal + estimatedFee : Number(order.final_amount);
  const canPay = order.payment_method === 'RAZORPAY' && order.final_amount && order.payment_status !== 'PAID';
  const quoteReady = ['quoted','confirmed','in_progress','ready'].includes(order.order_status) && order.final_amount != null && order.payment_status !== 'PAID';
  const upiUri = `upi://pay?pa=9993462892%40ybl&pn=NoteKart&am=${encodeURIComponent(order.final_amount||'')}&cu=INR&tn=${encodeURIComponent(order.order_number)}`;
  let paymentMarkup = '';
  if (quoteReady && order.payment_method === 'PENDING') paymentMarkup = `<section class="upi-payment"><h3>Quote confirmed: ₹${escapeHtml(order.final_amount)}</h3><p>Choose how you want to pay.</p><div class="upi-payment-actions"><button class="button" data-choose-payment="COD" data-order-id="${escapeAttr(order.id)}">Pay on delivery</button><button class="button" data-choose-payment="UPI" data-order-id="${escapeAttr(order.id)}">Pay now with UPI</button></div></section>`;
  else if (quoteReady && order.payment_method === 'COD') paymentMarkup = `<div class="upi-payment"><h3>Pay on delivery</h3><p>Your quoted total is due when the order is delivered.</p><p><b>Delivery address:</b> ${escapeHtml(order.delivery_address||'Not saved yet')}</p><button class="quiet-link" data-choose-payment="COD" data-current-address="${escapeAttr(order.delivery_address||'')}" data-order-id="${escapeAttr(order.id)}">${order.delivery_address?'Update delivery address':'Add delivery address'}</button><button class="quiet-link" data-choose-payment="UPI" data-order-id="${escapeAttr(order.id)}">Switch to UPI payment</button></div>`;
  else if (quoteReady && ['UPI','RAZORPAY'].includes(order.payment_method)) paymentMarkup = `<section class="upi-payment"><h3>Pay ₹${escapeHtml(order.final_amount)} by UPI</h3><p>Scan this QR with your UPI app. The payment will remain pending until NoteKart verifies it.</p><div class="upi-qr" id="upi-qr" data-upi-uri="${escapeAttr(upiUri)}"></div><p class="upi-id">UPI ID: <b>9993462892@ybl</b></p><a class="button small" href="${escapeAttr(upiUri)}">Open UPI app</a>${order.transaction_id?`<p class="form-hint">Reference ${escapeHtml(order.transaction_id)} submitted · awaiting verification.</p>`:`<form id="upi-reference-form" data-order-id="${escapeAttr(order.id)}"><label>UPI transaction reference<input name="reference" minlength="6" maxlength="80" required placeholder="Enter UTR / transaction ID"></label><button class="button" type="submit">Submit payment reference</button></form><button class="quiet-link" data-choose-payment="COD" data-order-id="${escapeAttr(order.id)}">Switch to pay on delivery</button>`}</section>`;
  const rows = [['Page count',order.page_count],['Pages subtotal','₹' + pageSubtotal],['Delivery fee','₹' + delivery],['File',order.original_filename],['Client',order.client_name],['College',order.college_name],['Course',order.course_name],['Branch',order.branch_name],['Academic year',order.academic_year],['Semester',order.semester],['Section',order.section],['Enrollment',order.enrollment_number],['Contact',order.contact_number],['Location',order.location_name],['Payment',order.payment_method + ' · ' + order.payment_status],['Delivery address',order.delivery_address||'Not provided'],['Status',order.order_status],['Quote total',order.final_amount == null ? 'Estimated ₹' + total : '₹' + total]];
  return `<div class="modal-eyebrow">${escapeHtml(order.order_number)}</div><h2 id="modal-title">${escapeHtml(order.work_type)}</h2><div class="receipt-grid">${rows.map(([label,value]) => `<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>${paymentMarkup}
    ${canPay ? `<button class="button full" data-pay-order="${escapeAttr(order.id)}">Pay ₹${escapeHtml(order.final_amount)} <span>↗</span></button>` : ''}
    <a class="button full" target="_blank" rel="noopener" href="${apiBase}/api/orders/${encodeURIComponent(order.id)}/file">Open uploaded file <span>↗</span></a>
    <a class="text-button" href="${apiBase}/api/orders/${encodeURIComponent(order.id)}/file?download=1">Download original file</a><p class="form-hint">Uploaded files are read-only in NoteKart.</p>
    <a class="button full" href="${apiBase}/api/orders/${encodeURIComponent(order.id)}/receipt?download=1">Download receipt <span>↗</span></a>
    <a class="text-button" target="_blank" rel="noopener" href="${apiBase}/api/orders/${encodeURIComponent(order.id)}/receipt">View receipt</a>`;
}
async function refreshUser() {
  try {
    const data = await api('/api/auth/me');
    currentUser = data.user;
    csrfToken = data.csrf;
    if(currentUser?.is_admin){location.replace(`${apiBase}/dashboard/admin`);return;}
    updateNav();
    if (!currentUser && location.pathname.startsWith('/dashboard')) openModal('login');
    if (new URLSearchParams(location.search).get('access') === 'denied') toast('This account does not have administrator access.');
  } catch { currentUser = null; updateNav(); }
}
async function startPayment(orderId) {
  try {
    const order = await api('/api/payments/create', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({orderId}) });
    if (!window.Razorpay) await new Promise((resolve,reject) => {
      const script = document.createElement('script'); script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.onload = resolve; script.onerror = reject; document.head.append(script);
    });
    const checkout = new window.Razorpay({ key:order.keyId, amount:order.amount, currency:order.currency, name:'NoteKart', description:'College work order', order_id:order.razorpayOrderId,
      handler:async response => { try { await api('/api/payments/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(response)}); toast('Payment verified. Thank you!'); showWorkspaceView('orders'); } catch (error) { toast(error.message); } },
      modal:{ondismiss:() => toast('Payment was not completed.')} });
    checkout.open();
  } catch (error) { toast(error.message); }
}
async function openOrderDetail(orderId) {
  try { const order = await api(`/api/orders/${encodeURIComponent(orderId)}`); content.innerHTML = orderDetailMarkup(order); modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); document.body.style.overflow = 'hidden'; renderUpiQr(); }
  catch (error) { toast(error.message); }
}
function renderUpiQr() {
  const target = content.querySelector('#upi-qr');
  if (!target) return;
  const render = () => { if (!window.QRCode || !target.isConnected) return; target.replaceChildren(); new window.QRCode(target,{text:target.dataset.upiUri,width:240,height:240,colorDark:'#122b4c',colorLight:'#ffffff',correctLevel:window.QRCode.CorrectLevel.M}); };
  if (window.QRCode) { render(); return; }
  const existing = document.querySelector('script[data-qrcode-lib]');
  if (existing) { existing.addEventListener('load',render,{once:true}); return; }
  const script = document.createElement('script'); script.dataset.qrcodeLib = 'true'; script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'; script.onload = render; document.head.append(script);
}

// Workspace navigation and upload management.
document.addEventListener('click', async event => {
  const view = event.target.closest('[data-workspace-view]');
  if (view) { event.preventDefault(); showWorkspaceView(view.dataset.workspaceView); return; }
  const trigger = event.target.closest('[data-open]');
  if (trigger) { event.preventDefault(); openModal(trigger.dataset.open); return; }
  if (event.target.closest('.modal-close')) { closeModal(); return; }
  const switcher = event.target.closest('[data-switch]');
  if (switcher) { event.preventDefault(); openModal(switcher.dataset.switch); return; }
  if (event.target.closest('[data-back-order]')) {
    clearOrderPreview();
    content.querySelector('#order-review')?.remove();
    if (pendingOrderForm) pendingOrderForm.hidden = false;
    const title = content.querySelector('#modal-title');
    if (title) title.textContent = 'Submit your work';
    return;
  }
  if (event.target.closest('[data-confirm-order]')) {
    if (pendingOrderForm) { pendingOrderForm.dataset.reviewConfirmed = 'true'; pendingOrderForm.requestSubmit(); }
    return;
  }
  const deleteButton = event.target.closest('[data-delete-order]');
  if (deleteButton) {
    event.preventDefault();
    if (!window.confirm('Delete this pending upload and its stored file? This cannot be undone.')) return;
    deleteButton.disabled = true;
    try { const result = await api(`/api/orders/${encodeURIComponent(deleteButton.dataset.deleteOrder)}`, {method:'DELETE'}); toast(result.message); await showWorkspaceView('orders'); }
    catch (error) { toast(error.message); deleteButton.disabled = false; }
    return;
  }
  const adminRefresh = event.target.closest('[data-admin-refresh]');
  if (adminRefresh) { const pane = workspaceRoot.querySelector('#workspace-content'); await showAdminOrders(pane, pane.querySelector('#admin-status-filter')?.value || ''); return; }
  const refreshOrders = event.target.closest('[data-refresh-orders]');
  if (refreshOrders) { refreshOrders.disabled = true; await showWorkspaceView('orders'); return; }
  const adminQuote = event.target.closest('[data-admin-quote]');
  if (adminQuote) {
    adminQuote.disabled = true;
    try { const result = await api(`/api/admin/orders/${encodeURIComponent(adminQuote.dataset.adminQuote)}/quote`,{method:'PATCH',headers:{'content-type':'application/json'},body:'{}'}); toast(`${result.message} Total: ₹${result.final_amount}.`); const pane = workspaceRoot.querySelector('#workspace-content'); await showAdminOrders(pane,pane.querySelector('#admin-status-filter')?.value || ''); }
    catch (error) { toast(error.message); adminQuote.disabled = false; }
    return;
  }
  const adminStatus = event.target.closest('[data-admin-status]');
  if (adminStatus) {
    adminStatus.disabled = true;
    try { const result = await api(`/api/admin/orders/${encodeURIComponent(adminStatus.dataset.orderId)}/status`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status:adminStatus.dataset.adminStatus})}); toast(result.message); const pane = workspaceRoot.querySelector('#workspace-content'); await showAdminOrders(pane,pane.querySelector('#admin-status-filter')?.value || ''); }
    catch (error) { toast(error.message); adminStatus.disabled = false; }
    return;
  }
  const choosePayment = event.target.closest('[data-choose-payment]');
  if (choosePayment) {
    if(choosePayment.dataset.choosePayment==='COD'){
      const orderId=choosePayment.dataset.orderId;
      const currentAddress=choosePayment.dataset.currentAddress||'';
      content.innerHTML=`<div class="modal-eyebrow">CASH ON DELIVERY</div><h2 id="modal-title">Where should we deliver?</h2><p>Enter the full delivery address for this order. It will be visible only to you and NoteKart administrators handling the order.</p><form id="cod-address-form" data-order-id="${escapeAttr(orderId)}"><label>Delivery address<textarea name="deliveryAddress" rows="4" minlength="10" maxlength="500" autocomplete="street-address" placeholder="House/flat, street, area, landmark, city, state, PIN code" required>${escapeHtml(currentAddress)}</textarea><small>Include your PIN code so delivery can be completed.</small></label><button class="button full" type="submit">Save address and choose COD</button><button class="quiet-link" type="button" data-cancel-cod="${escapeAttr(orderId)}">Back to order</button></form>`;
      return;
    }
    choosePayment.disabled = true;
    try { const result = await api(`/api/orders/${encodeURIComponent(choosePayment.dataset.orderId)}/payment-method`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method:choosePayment.dataset.choosePayment})}); toast(result.message); await openOrderDetail(choosePayment.dataset.orderId); }
    catch (error) { toast(error.message); choosePayment.disabled = false; }
    return;
  }
  if (event.target.closest('#dashboard-orders')) { event.preventDefault(); closeModal(); showWorkspaceView('orders'); return; }
  const cancelCod=event.target.closest('[data-cancel-cod]');if(cancelCod){await openOrderDetail(cancelCod.dataset.cancelCod);return;}
  if (event.target.closest('#my-profile')) { showWorkspaceView('profile'); return; }
  if (event.target.closest('#logout,#workspace-logout')) {
    try { await api('/api/auth/logout',{method:'POST'}); currentUser = null; if (apiBase) { location.assign(`${apiBase}/`); return; } history.replaceState({},'', '/'); updateNav(); closeModal(); toast('You are logged out.'); }
    catch (error) { toast(error.message); }
  }
  const payButton = event.target.closest('[data-pay-order]');
  if (payButton) { event.preventDefault(); await startPayment(payButton.dataset.payOrder); return; }
  const orderRow = event.target.closest('.workspace-order-row[data-order-id]');
  if (orderRow) {
    event.preventDefault();
    await openOrderDetail(orderRow.dataset.orderId);
  }
});

document.addEventListener('change', event => {
  if (event.target.name === 'workFile') {
    const label = event.target.closest('label'); let note = label.querySelector('.selected-file');
    if (!note) { note = document.createElement('small'); note.className = 'selected-file'; label.append(note); }
    note.textContent = event.target.files[0]?.name || '';
  }
  if (event.target.id === 'profile-photo-file') {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 5 * 1024 * 1024) { event.target.value = ''; toast('Choose an image smaller than 5 MB.'); return; }
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { event.target.value = ''; toast('Choose a JPG, PNG, or WebP image.'); return; }
    const preview = document.querySelector('#profile-photo-preview');
    if (preview) { preview.replaceChildren(); const image = document.createElement('img'); image.className = 'workspace-avatar photo profile-photo-large'; image.alt = 'Selected profile photo preview'; image.src = URL.createObjectURL(file); preview.append(image); }
  }
  if (event.target.id === 'admin-status-filter') showAdminOrders(workspaceRoot.querySelector('#workspace-content'),event.target.value);
});
document.addEventListener('input', event => {
  if (event.target.id !== 'order-search') return;
  const query = event.target.value.trim().toLowerCase();
  const filtered = myOrders.filter(order => order.order_number.toLowerCase().includes(query) || order.id.toLowerCase().includes(query));
  const results = document.querySelector('#orders-results');
  if (results) results.innerHTML = filtered.length ? renderOrderRows(filtered) : '<div class="empty-workspace"><h3>No matching order</h3><p>Check the order number or UUID and try again.</p></div>';
});

document.addEventListener('submit', async event => {
  const form = event.target;
  if(form.id==='cod-address-form'){
    event.preventDefault();const orderId=form.dataset.orderId,button=form.querySelector('button[type="submit"]');button.disabled=true;
    try{const result=await api(`/api/orders/${encodeURIComponent(orderId)}/payment-method`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method:'COD',deliveryAddress:form.elements.deliveryAddress.value})});toast(result.message);await openOrderDetail(orderId);}
    catch(error){toast(error.message);button.disabled=false;}return;
  }
  if (form.id === 'login-form') {
    event.preventDefault();
    try { const result = await api('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))}); csrfToken = result.csrf; location.assign(`${apiBase}${result.redirectTo || (result.isAdmin?'/dashboard/admin':'/dashboard/workspace')}`); }
    catch (error) { toast(error.message); }
  }
  if (form.id === 'register-form') {
    event.preventDefault();
    try { const result = await api('/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))}); openModal('login'); toast(result.message); }
    catch (error) { toast(error.message); }
  }
  if (form.id === 'profile-form') {
    event.preventDefault();
    try { const result = await api('/api/auth/profile',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))}); currentUser = result.user; updateNav(false); showWorkspaceView('profile'); toast(result.message); }
    catch (error) { toast(error.message); }
  }
  if (form.id === 'photo-form') {
    event.preventDefault(); const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    try { const result = await api('/api/auth/profile/photo',{method:'POST',body:new FormData(form)}); currentUser = result.user; updateNav(false); const avatar = workspaceRoot.querySelector('.workspace-top-actions .workspace-avatar'); if (avatar) avatar.outerHTML = avatarMarkup(currentUser); showWorkspaceView('profile'); toast(result.message); }
    catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  }
  if (form.id === 'order-form') {
    event.preventDefault();
    if (form.dataset.reviewConfirmed !== 'true') { showOrderReview(form); return; }
    delete form.dataset.reviewConfirmed;
    const button = form.querySelector('button[type="submit"],button.full'); button.disabled = true; button.textContent = 'Sending your order…';
    try { const result = await api('/api/orders',{method:'POST',headers:{'Idempotency-Key':pendingOrderKey},body:new FormData(form)}); pendingOrderKey = null; closeModal(); toast(result.message); openOrderConfirmation(result); }
    catch (error) { toast(error.message); }
    finally { button.disabled = false; button.innerHTML = 'Submit order <span>↗</span>'; }
  }
  if (form.id === 'upi-reference-form') {
    event.preventDefault(); const orderId=form.dataset.orderId,button=form.querySelector('button[type="submit"]');button.disabled=true;
    try { const result=await api(`/api/orders/${encodeURIComponent(orderId)}/upi-reference`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reference:form.elements.reference.value})});toast(result.message);await openOrderDetail(orderId); }
    catch(error){toast(error.message);button.disabled=false;}
  }
});

modal.querySelector('.modal-backdrop').addEventListener('click', closeModal);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && modal.classList.contains('open')) closeModal(); });
refreshUser();
