const STORAGE_KEY = 'cafebilling_state_v2';
const LEGACY_STORAGE_KEY = 'cafebilling_state_v1';
const THEME_STORAGE_KEY = 'cafebilling_theme_v1';
const VIEW_STORAGE_KEY = 'cafebilling_view_v2';
const EDIT_WINDOW_MS = 5 * 60 * 1000;
const TAX_RATE = 0.1;
const GITHUB_REPO = 'ridhoae303/CafeBilling';
const DEFAULT_IMAGE = './assets/images/espresso.svg';
const DEVELOPER_AVATAR = 'https://github.com/ridhoae303.png';

const BUILTIN_PRODUCT_IMAGES = Object.freeze({
  espresso: './assets/images/espresso.svg',
  cappuccino: './assets/images/cappuccino.svg',
  icedlatte: './assets/images/iced-latte.svg',
  croissant: './assets/images/croissant.svg',
  sandwich: './assets/images/sandwich.svg',
  chocolatecake: './assets/images/cake.svg',
  americano: './assets/images/americano.svg',
  caramelmacchiato: './assets/images/caramel-macchiato.svg',
  matchalatte: './assets/images/matcha-latte.svg',
  lemontea: './assets/images/lemon-tea.svg',
  mocha: './assets/images/mocha.svg',
  blueberrymuffin: './assets/images/blueberry-muffin.svg',
  frenchfries: './assets/images/french-fries.svg',
  pancake: './assets/images/pancake.svg',
  donut: './assets/images/donut.svg',
  tiramisu: './assets/images/tiramisu.svg',
  affogato: './assets/images/affogato.svg',
  hotchocolate: './assets/images/hot-chocolate.svg',
  strawberrysmoothie: './assets/images/strawberry-smoothie.svg',
  garlicbread: './assets/images/garlic-bread.svg',
  waffle: './assets/images/waffle.svg',
  chickenpie: './assets/images/chicken-pie.svg',
  cheesecake: './assets/images/cheesecake.svg',
  chocolatecookies: './assets/images/chocolate-cookies.svg'
});

function productImageKey(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function getBuiltinProductAsset(product) {
  const key = productImageKey(product?.name);
  const asset = BUILTIN_PRODUCT_IMAGES[key];
  if (!asset) return '';
  return asset;
}

function getResolvedProductImage(product) {
  if (!product || typeof product !== 'object') return DEFAULT_IMAGE;

  const suppliedImage = safeImage(product.image);
  if (suppliedImage !== DEFAULT_IMAGE) return suppliedImage;

  return getBuiltinProductAsset(product) || DEFAULT_IMAGE;
}

const ADMIN_CONFIG_URL = 'data/admin.json';
const AUTH_STORAGE_KEY = 'cafebilling_admin_session_v2';
const LEGACY_AUTH_STORAGE_KEY = 'cafebilling_admin_session_v1';
let adminConfigPromise = null;
let activeReceipt = null;
let checkoutBusy = false;
let checkoutEditOrderId = null;
let checkoutEditItems = [];
let checkoutEditTimer = null; let customerHistoryTimer = null;

try {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
} catch {}

function isAdmin() {
  try {
    if (localStorage.getItem(AUTH_STORAGE_KEY) === '1') return true;
    if (sessionStorage.getItem(LEGACY_AUTH_STORAGE_KEY) === '1') {
      localStorage.setItem(AUTH_STORAGE_KEY, '1');
      sessionStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
      return true;
    }
  } catch {
    try {
      return sessionStorage.getItem(AUTH_STORAGE_KEY) === '1' || sessionStorage.getItem(LEGACY_AUTH_STORAGE_KEY) === '1';
    } catch {}
  }
  return false;
}

function setAdminSession(enabled) {
  try {
    if (enabled) {
      localStorage.setItem(AUTH_STORAGE_KEY, '1');
      sessionStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      sessionStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
    }
  } catch {
    try {
      if (enabled) sessionStorage.setItem(AUTH_STORAGE_KEY, '1');
      else sessionStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {}
  }
  refreshAccessUI();
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchAdminConfig() {
  if (!adminConfigPromise) {
    if (window.CAFEBILLING_ADMIN_CONFIG && typeof window.CAFEBILLING_ADMIN_CONFIG === 'object') {
      adminConfigPromise = Promise.resolve(window.CAFEBILLING_ADMIN_CONFIG);
    } else {
      adminConfigPromise = fetch(ADMIN_CONFIG_URL, { cache: 'no-store' })
        .then((response) => {
          if (!response.ok) throw new Error('Admin config tidak tersedia.');
          return response.json();
        });
    }
  }
  return adminConfigPromise;
}

function requireAdmin(action = 'fitur admin ini') {
  if (isAdmin()) return true;
  openLoginModal(action);
  return false;
}

function refreshAccessUI() {
  const admin = isAdmin();
  document.body.classList.toggle('is-admin', admin);
  document.body.classList.toggle('is-user', !admin);
  document.body.classList.toggle('customer-mode', !admin);
  document.body.classList.toggle('admin-mode', admin);

  const authButton = $('#authNavButton');
  if (authButton) {
    authButton.innerHTML = admin
      ? '<i data-lucide="log-out"></i><span>Logout Admin</span>'
      : '<i data-lucide="shield-check"></i><span>Login Admin</span>';
    authButton.dataset.authState = admin ? 'logout' : 'login';
  }

  const roleChip = $('#roleChip');
  if (roleChip) {
    roleChip.innerHTML = admin
      ? '<i data-lucide="shield-check"></i><span>Admin / Kasir</span>'
      : '<i data-lucide="user"></i><span>User / Pelanggan</span>';
  }

  const inventoryNav = document.querySelector('[data-view="inventory"]');
  const salesNav = document.querySelector('[data-view="sales"]');
  const historyNav = document.querySelector('[data-view="history"]');
  const catalogNav = document.querySelector('[data-view="catalog"]');
  const salesLabel = salesNav?.querySelector('span:not(.nav-count)');
  if (salesLabel) salesLabel.textContent = admin ? 'Kasir' : 'Keranjang';
  if (inventoryNav) inventoryNav.hidden = !admin;
  if (salesNav) salesNav.hidden = !admin;
  if (historyNav) historyNav.hidden = !admin;
  if (catalogNav) catalogNav.hidden = admin;

  const resetButton = $('#resetData');
  if (resetButton) {
    resetButton.hidden = !admin;
    resetButton.closest('.sidebar-bottom')?.classList.toggle('admin-tools-visible', admin);
  }

  $('#adminDashboard')?.toggleAttribute('hidden', !admin);
  $('#userDashboard')?.toggleAttribute('hidden', admin);

  if ((!admin && ['inventory', 'sales', 'history'].includes(currentView)) ||
      (admin && currentView === 'catalog')) {
    setView(admin ? 'dashboard' : 'dashboard');
  }

  initIcons();
}
function openLoginModal(reason = 'mengakses fitur admin') {
  const modal = $('#loginModal');
  if (!modal) return;

  $('#loginStatus').textContent = reason ? `Login diperlukan untuk ${reason}.` : '';
  $('#adminPassword').value = '';
  const passwordInput = $('#adminPassword');
  const passwordToggle = $('#toggleAdminPassword');
  if (passwordInput) passwordInput.type = 'password';
  if (passwordToggle) {
    passwordToggle.setAttribute('aria-pressed', 'false');
    passwordToggle.setAttribute('aria-label', 'Tampilkan password');
    passwordToggle.setAttribute('title', 'Tampilkan password');
    passwordToggle.innerHTML = '<i data-lucide="eye"></i>';
  }
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  window.setTimeout(() => $('#adminUsername').focus(), 120);
  initIcons();
}

function isAdminRoute() {
  const path = window.location.pathname.replace(/\/+$/, '');
  return /\/admin(?:\/index\.html)?$/i.test(path);
}

function getPublicHomeUrl() {
  return isAdminRoute() ? new URL('../', window.location.href) : new URL(window.location.href);
}

function returnToPublicHome() {
  if (!isAdminRoute()) return;
  const home = getPublicHomeUrl();
  window.location.replace(`${home.pathname}${home.search}${home.hash}`);
}

function closeLoginModal(returnHome = false) {
  const modal = $('#loginModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  $('#loginStatus').textContent = '';
  if (returnHome) returnToPublicHome();
}

async function handleAdminLogin(event) {
  event.preventDefault();

  const username = $('#adminUsername').value.trim();
  const password = $('#adminPassword').value;
  const status = $('#loginStatus');
  const submit = $('#loginForm button[type="submit"]');

  if (!username || !password) {
    status.textContent = 'Username dan password wajib diisi.';
    return;
  }

  submit.disabled = true;
  status.textContent = 'Memverifikasi akun admin…';

  try {
    const config = await fetchAdminConfig();
    const passwordHash = await sha256(password);
    const valid = username.toLowerCase() === String(config.username || '').toLowerCase()
      && passwordHash === String(config.password_sha256 || '').toLowerCase();

    if (!valid) {
      status.textContent = 'Username atau password salah.';
      $('#adminPassword').select();
      return;
    }

    setAdminSession(true);
    closeLoginModal();
    setView('dashboard');
    showToast('Login admin berhasil', 'shield-check');
  } catch (error) {
    status.textContent = 'Konfigurasi admin tidak dapat dibaca. Coba lagi.';
  } finally {
    submit.disabled = false;
  }
}

function handleAuthNavigation() {
  if (isAdmin()) {
    setAdminSession(false);
    closeProductModal();
    setView('dashboard');
    showToast('Sesi admin ditutup', 'log-out');
    return;
  }
  openLoginModal('mengakses dashboard admin');
}

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}


const BUILTIN_PRODUCTS = Object.freeze([
  { name: 'Espresso', category: 'Kopi', price: 18000, stock: 24, image: './assets/images/espresso.svg' },
  { name: 'Cappuccino', category: 'Kopi', price: 26000, stock: 18, image: './assets/images/cappuccino.svg' },
  { name: 'Iced Latte', category: 'Minuman', price: 24000, stock: 16, image: './assets/images/iced-latte.svg' },
  { name: 'Croissant', category: 'Makanan', price: 22000, stock: 12, image: './assets/images/croissant.svg' },
  { name: 'Sandwich', category: 'Makanan', price: 28000, stock: 10, image: './assets/images/sandwich.svg' },
  { name: 'Chocolate Cake', category: 'Snack', price: 25000, stock: 9, image: './assets/images/cake.svg' },
  { name: 'Americano', category: 'Kopi', price: 21000, stock: 20, image: './assets/images/americano.svg' },
  { name: 'Caramel Macchiato', category: 'Kopi', price: 29000, stock: 14, image: './assets/images/caramel-macchiato.svg' },
  { name: 'Matcha Latte', category: 'Minuman', price: 27000, stock: 15, image: './assets/images/matcha-latte.svg' },
  { name: 'Lemon Tea', category: 'Minuman', price: 19000, stock: 17, image: './assets/images/lemon-tea.svg' },
  { name: 'Mocha', category: 'Kopi', price: 28000, stock: 13, image: './assets/images/mocha.svg' },
  { name: 'Blueberry Muffin', category: 'Makanan', price: 21000, stock: 11, image: './assets/images/blueberry-muffin.svg' },
  { name: 'French Fries', category: 'Makanan', price: 20000, stock: 18, image: './assets/images/french-fries.svg' },
  { name: 'Pancake', category: 'Makanan', price: 24000, stock: 8, image: './assets/images/pancake.svg' },
  { name: 'Donut', category: 'Snack', price: 15000, stock: 16, image: './assets/images/donut.svg' },
  { name: 'Tiramisu', category: 'Snack', price: 27000, stock: 7, image: './assets/images/tiramisu.svg' },
  { name: 'Affogato', category: 'Kopi', price: 30000, stock: 10, image: './assets/images/affogato.svg' },
  { name: 'Hot Chocolate', category: 'Minuman', price: 25000, stock: 12, image: './assets/images/hot-chocolate.svg' },
  { name: 'Strawberry Smoothie', category: 'Minuman', price: 28000, stock: 10, image: './assets/images/strawberry-smoothie.svg' },
  { name: 'Garlic Bread', category: 'Makanan', price: 18000, stock: 15, image: './assets/images/garlic-bread.svg' },
  { name: 'Waffle', category: 'Makanan', price: 23000, stock: 9, image: './assets/images/waffle.svg' },
  { name: 'Chicken Pie', category: 'Makanan', price: 26000, stock: 8, image: './assets/images/chicken-pie.svg' },
  { name: 'Cheesecake', category: 'Snack', price: 29000, stock: 8, image: './assets/images/cheesecake.svg' },
  { name: 'Chocolate Cookies', category: 'Snack', price: 16000, stock: 20, image: './assets/images/chocolate-cookies.svg' }
]);

let state = loadState();
let currentView = 'dashboard';

function getSavedView() {
  try {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY);
    return saved && /^(?:dashboard|catalog|inventory|sales|history|developer)$/.test(saved) ? saved : 'dashboard';
  } catch {
    return 'dashboard';
  }
}

function saveView(view) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {}
}
let currentCategory = 'Semua';
window.catalogCategory = 'Semua';
let customerCart = state.customerCart || [];
let customerOrders = state.customerOrders || [];
let cashierCart = state.cashierCart || state.cart || [];
let pendingOrders = state.pendingOrders || [];
let orderEditRequests = state.orderEditRequests || [];
let cart = cashierCart;
let sales = state.sales || [];
let products = state.products?.length
  ? state.products
  : BUILTIN_PRODUCTS.map((product) => ({ id: makeId(), ...product }));
let contributorsLoaded = false;




products = products.map((product) => normalizeProduct(product)).filter(Boolean);

for (const builtIn of BUILTIN_PRODUCTS) {
  const exists = products.some((product) => productImageKey(product.name) === productImageKey(builtIn.name));
  if (!exists) products.push({ id: makeId(), ...builtIn });
}

for (const product of products) product.image = getProductImage(product);
for (const item of customerCart) {
  const product = products.find((entry) => entry.id === item.productId);
  if (product) syncCartItem(item, product);
}
for (const item of cashierCart) {
  const product = products.find((entry) => entry.id === item.productId);
  if (product) syncCartItem(item, product);
}
for (const sale of sales) {
  sale.items = sale.items.map((item) => {
    const product = products.find((entry) => entry.id === item.productId);
    return product ? { ...item, name: product.name, price: product.price, image: getProductImage(product) } : item;
  });
}
try {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ products, sales, customerCart, customerOrders, cashierCart, pendingOrders, orderEditRequests }));
} catch {}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function getProductImage(product) {
  return getResolvedProductImage(product);
}

function resolveImageSource(source) {
  const value = safeImage(source);
  try {
    return new URL(value, document.baseURI).href;
  } catch {
    return value;
  }
}

function normalizeProduct(product) {
  if (!product || typeof product !== 'object') return null;

  const id = String(product.id || '').trim();
  const name = String(product.name || '').trim();
  const category = String(product.category || 'Lainnya').trim() || 'Lainnya';

  if (!id || !name) return null;

  const builtinImage = getBuiltinProductAsset({ name });

  return {
    id,
    name: name.slice(0, 120),
    category: category.slice(0, 40),
    price: Math.max(0, Number.isFinite(Number(product.price)) ? Number(product.price) : 0),
    stock: Math.max(0, Math.floor(Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0)),
    image: builtinImage || safeImage(product.image)
  };
}

function normalizeCartItem(item) {
  if (!item || typeof item !== 'object') return null;
  const productId = String(item.productId || '').trim();
  const qty = Math.max(0, Math.floor(Number(item.qty) || 0));
  return productId && qty > 0 ? { productId, qty } : null;
}

function normalizeSale(sale) {
  if (!sale || typeof sale !== 'object' || !Array.isArray(sale.items)) return null;

  const items = sale.items.map((item) => {
    if (!item || typeof item !== 'object') return null;
    const productId = String(item.productId || '').trim();
    const name = String(item.name || 'Item').trim();
    const qty = Math.max(0, Math.floor(Number(item.qty) || 0));
    const price = Math.max(0, Number(item.price) || 0);
    return productId && qty > 0 ? { productId, name: name.slice(0, 120), qty, price, image: safeImage(item.image) } : null;
  }).filter(Boolean);

  if (!items.length) return null;

  return {
    id: String(sale.id || '').trim() || `TRX-${Date.now()}`,
    date: String(sale.date || ''),
    dateLabel: String(sale.dateLabel || ''),
    items,
    subtotal: Math.max(0, Number(sale.subtotal) || 0),
    tax: Math.max(0, Number(sale.tax) || 0),
    total: Math.max(0, Number(sale.total) || 0),
    cash: Math.max(0, Number(sale.cash) || 0),
    change: Math.max(0, Number(sale.change) || 0)
  };
}

function normalizePendingOrder(order) {
  if (!order || typeof order !== 'object' || !Array.isArray(order.items)) return null;
  const items = order.items.map((item) => {
    if (!item || typeof item !== 'object') return null;
    const productId = String(item.productId || '').trim();
    const name = String(item.name || 'Item').trim();
    const qty = Math.max(0, Math.floor(Number(item.qty) || 0));
    const price = Math.max(0, Number(item.price) || 0);
    return productId && qty > 0 ? { productId, name: name.slice(0, 120), qty, price, image: safeImage(item.image) } : null;
  }).filter(Boolean);
  if (!items.length) return null;
  return { id: String(order.id || '').trim() || `ORD-${Date.now()}`, createdAt: String(order.createdAt || new Date().toISOString()), updatedAt: String(order.updatedAt || ''), status: String(order.status || 'pending'), editRequested: Boolean(order.editRequested), editUsed: Boolean(order.editUsed || order.editRequested), appliedItems: Array.isArray(order.appliedItems) ? order.appliedItems.map((item) => ({ productId: String(item.productId || ''), qty: Math.max(0, Math.floor(Number(item.qty) || 0)) })).filter((item) => item.productId && item.qty > 0) : [], items, subtotal: Math.max(0, Number(order.subtotal) || 0), tax: Math.max(0, Number(order.tax) || 0), total: Math.max(0, Number(order.total) || 0) };
}

function loadState() {
  try {
    let parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed || typeof parsed !== 'object') parsed = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY));
    if (!parsed || typeof parsed !== 'object') return {};
    const legacyCart = Array.isArray(parsed.cart) ? parsed.cart.map(normalizeCartItem).filter(Boolean) : [];
    return {
      products: Array.isArray(parsed.products) ? parsed.products.map(normalizeProduct).filter(Boolean) : [],
      sales: Array.isArray(parsed.sales) ? parsed.sales.map(normalizeSale).filter(Boolean) : [],
      customerCart: Array.isArray(parsed.customerCart) ? parsed.customerCart.map(normalizeCartItem).filter(Boolean) : [],
      customerOrders: Array.isArray(parsed.customerOrders) ? parsed.customerOrders.map(normalizePendingOrder).filter(Boolean) : (Array.isArray(parsed.pendingOrders) ? parsed.pendingOrders.map(normalizePendingOrder).filter(Boolean) : []),
      cashierCart: Array.isArray(parsed.cashierCart) ? parsed.cashierCart.map(normalizeCartItem).filter(Boolean) : legacyCart,
      pendingOrders: Array.isArray(parsed.pendingOrders) ? parsed.pendingOrders.map(normalizePendingOrder).filter(Boolean) : [],
      orderEditRequests: Array.isArray(parsed.orderEditRequests) ? parsed.orderEditRequests.map(normalizePendingOrder).filter(Boolean) : []
    };
  } catch { return {}; }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ products, sales, customerCart, customerOrders, cashierCart, pendingOrders, orderEditRequests }));
    return true;
  } catch {
    showToast('Data tidak dapat disimpan di browser', 'hard-drive-off');
    return false;
  }
}

function money(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value || 0);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (match) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[match]));
}

function safeImage(source) {
  const value = String(source || '').trim();
  if (!value) return DEFAULT_IMAGE;

  if (/^https:\/\//i.test(value)) return value.slice(0, 2000);
  if (/^(?:\.\/)?assets\/images\/[a-z0-9._-]+\.(?:svg|png|jpe?g|webp|gif)$/i.test(value)) {
    return value.slice(0, 2000);
  }

  return DEFAULT_IMAGE;
}

let iconFrame = 0;

function initIcons() {
  if (!window.lucide || iconFrame) return;

  iconFrame = window.requestAnimationFrame(() => {
    iconFrame = 0;
    lucide.createIcons({
      attrs: {
        'stroke-width': 1.9
      }
    });
  });
}

function getSavedTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  } catch {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }
}

function applyTheme(theme, persist = true) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = nextTheme;

  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {}
  }

  const toggle = $('#themeToggle');
  const icon = $('#themeIcon');
  if (toggle) {
    const dark = nextTheme === 'dark';
    toggle.setAttribute('aria-pressed', String(dark));
    toggle.setAttribute('aria-label', dark ? 'Aktifkan light theme' : 'Aktifkan dark theme');
    toggle.setAttribute('title', dark ? 'Light Theme' : 'Dark Theme');
    toggle.dataset.theme = nextTheme;
  }

  if (icon) {
    icon.setAttribute('data-lucide', nextTheme === 'dark' ? 'sun' : 'moon');
    icon.setAttribute('aria-label', nextTheme === 'dark' ? 'Light Theme' : 'Dark Theme');
    if (window.lucide) lucide.createIcons({ attrs: { 'stroke-width': 1.9 } });
  }

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', nextTheme === 'dark' ? '#000000' : '#f5f7fb');
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || getSavedTheme();
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

function showToast(message, icon = 'check-circle-2') {
  const box = document.createElement('div');
  box.className = 'toast';
  box.innerHTML = `
    <i data-lucide="${icon}"></i>
    <span>${escapeHtml(message)}</span>
  `;

  $('#toastContainer').appendChild(box);
  initIcons();

  window.setTimeout(() => box.remove(), 2800);
}

function updateClock() {
  const now = new Date();
  $('#liveClock').textContent = now.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function updateCartCount() {
  const count = isAdmin() ? cashierCart.reduce((total, item) => total + item.qty, 0) : customerCart.reduce((total, item) => total + item.qty, 0);
  $('#cartCount').textContent = count;
  const pending = $('#pendingOrderCount');
  if (pending) pending.textContent = `${pendingOrders.filter((order) => order.status === 'pending').length} pesanan`;
}

function setView(view) {
  const titles = {
    dashboard: 'Dashboard',
    catalog: 'Menu Produk',
    inventory: 'Stok Produk',
    sales: 'Kasir / Transaksi',
    history: 'Riwayat Transaksi',
    developer: 'Developer'
  };

  if (!isAdmin() && view !== 'catalog') view = 'catalog';
  if (isAdmin() && view === 'catalog') view = 'sales';
  const page = $(`#view-${view}`);
  if (!page) return;

  if (['inventory', 'sales', 'history'].includes(view) && !requireAdmin('mengakses area kasir')) return;

  currentView = view;
  saveView(view);

  $$('.view').forEach((element) => element.classList.remove('active'));
  $(`#view-${view}`)?.classList.add('active');

  $$('.nav-item').forEach((element) => {
    element.classList.toggle('active', element.dataset.view === view);
  });

  $('#pageTitle').textContent = titles[view] || titles.dashboard;
  $('#pageEyebrow').textContent = view === 'developer'
    ? 'DEVELOPER'
    : view === 'catalog'
      ? 'PRODUCT CATALOG'
      : view === 'sales'
        ? 'ADMIN / KASIR'
        : view === 'history'
          ? 'TRANSACTION RECORD'
          : 'POINT OF SALE';

  if (view === 'dashboard') renderDashboard();
  if (view === 'catalog') renderCatalog();
  if (view === 'inventory') renderInventory();
  if (view === 'sales') renderSales();
  if (view === 'history') renderHistory();
  if (view === 'developer') loadContributors();

  const resetScroll = () => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };

  resetScroll();
  window.requestAnimationFrame(resetScroll);
  closeMobileNavigation();
}
function renderDashboard() {
  const revenue = sales.reduce((total, sale) => total + sale.total, 0);
  const stock = products.reduce((total, product) => total + product.stock, 0);
  const recentSales = sales.slice(0, 5);

  $('#statProducts').textContent = products.length;
  $('#statStock').textContent = stock;
  $('#statTransactions').textContent = sales.length;
  $('#statRevenue').textContent = money(revenue);

  $('#recentSales').innerHTML = recentSales.length
    ? recentSales.map((sale) => {
        const firstItem = sale.items[0];
        const product = products.find((item) => item.id === firstItem?.productId);
        const image = resolveImageSource(product ? getProductImage(product) : safeImage(firstItem?.image));

        return `
          <div class="sale-mini">
            <img src="${escapeHtml(image)}" alt="">
            <div>
              <span class="name">${escapeHtml(sale.id)}</span>
              <span class="time">${escapeHtml(sale.dateLabel)}</span>
            </div>
            <strong>${money(sale.total)}</strong>
          </div>
        `;
      }).join('')
    : `
      <div class="cart-empty">
        <div>
          <i data-lucide="receipt-text"></i>
          <strong>Belum ada transaksi</strong>
          <span>Transaksi baru akan muncul di sini.</span>
        </div>
      </div>
    `;

  updateCartCount();
  initIcons();
}

function getProductStatus(stock) {
  if (stock <= 0) {
    return '<span class="status status-empty">Habis</span>';
  }

  if (stock <= 5) {
    return '<span class="status status-low">Menipis</span>';
  }

  return '<span class="status status-good">Tersedia</span>';
}

function renderInventory() {
  const query = ($('#inventorySearch').value || '').toLowerCase().trim();
  const filteredProducts = products.filter((product) => {
    const target = `${product.name} ${product.category}`.toLowerCase();
    return target.includes(query);
  });

  $('#inventoryCount').textContent = `${filteredProducts.length} produk`;

  $('#inventoryBody').innerHTML = filteredProducts.length
    ? filteredProducts.map((product) => `
        <tr>
          <td>
            <div class="product-cell">
              <img
                src="${escapeHtml(resolveImageSource(getProductImage(product)))}"
                data-fallback-src="${escapeHtml(resolveImageSource(getProductImage(product)))}"
                alt="${escapeHtml(product.name)}"
              >
              <div>
                <strong>${escapeHtml(product.name)}</strong>
                <span>${escapeHtml(product.id.slice(0, 8))}</span>
              </div>
            </div>
          </td>
          <td>${escapeHtml(product.category)}</td>
          <td><strong>${money(product.price)}</strong></td>
          <td>${product.stock}</td>
          <td>${getProductStatus(product.stock)}</td>
          <td>
            <div class="action-row">
              <button class="icon-button" type="button" data-action="edit-product" data-id="${escapeHtml(product.id)}" title="Edit">
                <i data-lucide="pencil"></i>
              </button>
              <button class="icon-button danger-soft" type="button" data-action="delete-product" data-id="${escapeHtml(product.id)}" title="Hapus">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `).join('')
    : `
      <tr>
        <td colspan="6">
          <div class="cart-empty">
            <div>
              <i data-lucide="search-x"></i>
              <strong>Produk tidak ditemukan</strong>
              <span>Coba kata kunci lain.</span>
            </div>
          </div>
        </td>
      </tr>
    `;

  initIcons();
}

const CATEGORY_FILTER_META = Object.freeze({
  Semua: { label: 'Semua Produk', icon: 'layout-grid' },
  Kopi: { label: 'Kopi', icon: 'coffee' },
  Minuman: { label: 'Minuman', icon: 'cup-soda' },
  Makanan: { label: 'Makanan', icon: 'utensils' },
  Snack: { label: 'Snack', icon: 'cookie' },
  Lainnya: { label: 'Lainnya', icon: 'ellipsis' }
});

function getCategoryFilterMeta(category) {
  return CATEGORY_FILTER_META[category] || { label: category, icon: 'tag' };
}

function getOrderedCategories() {
  const available = new Set(products.map((product) => product.category));
  const preferred = ['Kopi', 'Minuman', 'Makanan', 'Snack', 'Lainnya'];
  const ordered = preferred.filter((category) => available.has(category));
  const custom = [...available].filter((category) => !preferred.includes(category)).sort((a, b) => a.localeCompare(b, 'id'));
  return ['Semua', ...ordered, ...custom];
}

function renderCategoryFilters(container, selectedCategory, action) {
  if (!container) return 'Semua';
  const categories = getOrderedCategories();
  const selected = categories.includes(selectedCategory) ? selectedCategory : 'Semua';
  const counts = Object.fromEntries(categories.map((category) => [category, category === 'Semua' ? products.length : products.filter((product) => product.category === category).length]));
  container.innerHTML = `
    <button class="category-filter-all ${selected === 'Semua' ? 'active' : ''}" type="button" data-action="${action}" data-category="Semua" aria-pressed="${selected === 'Semua'}">
      <span class="category-filter-icon"><i data-lucide="layout-grid"></i></span>
      <span class="category-filter-copy"><small>FILTER</small><strong>Semua Produk</strong></span>
      <span class="category-filter-count">${counts.Semua}</span>
    </button>
    <div class="category-filter-list">
      ${categories.slice(1).map((category) => {
        const meta = getCategoryFilterMeta(category);
        const active = category === selected;
        return `
          <button class="category-filter-chip ${active ? 'active' : ''}" type="button" data-action="${action}" data-category="${escapeHtml(category)}" aria-pressed="${active}">
            <span class="category-filter-chip-icon"><i data-lucide="${meta.icon}"></i></span>
            <span>${escapeHtml(meta.label)}</span>
            <b>${counts[category]}</b>
          </button>
        `;
      }).join('')}
    </div>
  `;
  initIcons();
  return selected;
}

function renderCatalog() {
  const query = ($('#catalogSearch')?.value || '').toLowerCase().trim();
  const categoryRow = $('#catalogCategoryRow');
  const selectedCategory = renderCategoryFilters(categoryRow, window.catalogCategory || 'Semua', 'set-catalog-category');
  window.catalogCategory = selectedCategory;

  const filtered = products.filter((product) => {
    const matchesCategory = selectedCategory === 'Semua' || product.category === selectedCategory;
    const matchesSearch = product.name.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });

  const grid = $('#catalogGrid');
  if (!grid) return;

  grid.innerHTML = filtered.length ? filtered.map((product) => `
    <article class="catalog-card ${product.stock <= 0 ? 'sold-out' : ''}" data-action="add-customer-cart" data-id="${escapeHtml(product.id)}" tabindex="${product.stock > 0 ? '0' : '-1'}" role="button" aria-disabled="${product.stock <= 0 ? 'true' : 'false'}" aria-label="${escapeHtml(product.stock > 0 ? `Tambah ${product.name} ke keranjang` : `${product.name} sedang habis`)}">
      <img
        src="${escapeHtml(resolveImageSource(getProductImage(product)))}"
        data-fallback-src="${escapeHtml(resolveImageSource(getProductImage(product)))}"
        data-product-image-key="${escapeHtml(productImageKey(product.name))}"
        alt="${escapeHtml(product.name)}"
      >
      <div class="catalog-card-body">
        <span class="cat">${escapeHtml(product.category)}</span>
        <strong>${escapeHtml(product.name)}</strong>
        <div class="catalog-card-footer">
          <b>${money(product.price)}</b>
          <span>${product.stock > 0 ? 'Tersedia' : 'Habis'}</span>
        </div>
      </div>
    </article>
  `).join('') : `
    <div class="catalog-empty">
      <i data-lucide="package-x"></i>
      <strong>Produk tidak ditemukan</strong>
      <span>Silakan coba kata kunci atau kategori lain.</span>
    </div>
  `;

  initIcons();
}

function renderSales() {
  const query = ($('#salesSearch').value || '').toLowerCase().trim();
  currentCategory = renderCategoryFilters($('#categoryRow'), currentCategory, 'set-category');

  const filteredProducts = products.filter((product) => {
    const matchesCategory = currentCategory === 'Semua' || product.category === currentCategory;
    const matchesSearch = product.name.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });

  $('#productGrid').innerHTML = filteredProducts.length
    ? filteredProducts.map((product) => `
        <article
          class="product-card ${product.stock <= 0 ? 'disabled' : ''}"
          data-action="add-to-cart"
          data-id="${escapeHtml(product.id)}"
          tabindex="${product.stock > 0 ? '0' : '-1'}"
          role="button"
          aria-disabled="${product.stock <= 0 ? 'true' : 'false'}"
          aria-label="${escapeHtml(product.stock > 0 ? `Tambah ${product.name} ke keranjang` : `${product.name} sedang habis`)}"
        >
          <img
            src="${escapeHtml(resolveImageSource(getProductImage(product)))}"
            data-fallback-src="${escapeHtml(resolveImageSource(getProductImage(product)))}"
            data-product-image-key="${escapeHtml(productImageKey(product.name))}"
            alt="${escapeHtml(product.name)}"
          >
          <div class="product-card-body">
            <span class="cat">${escapeHtml(product.category)}</span>
            <strong>${escapeHtml(product.name)}</strong>
            <div class="product-bottom">
              <b>${money(product.price)}</b>
              <span>${product.stock > 0 ? `${product.stock} stok` : 'Habis'}</span>
            </div>
          </div>
        </article>
      `).join('')
    : `
      <div class="cart-empty">
        <div>
          <i data-lucide="package-x"></i>
          <strong>Produk tidak ditemukan</strong>
          <span>Tambahkan produk pada menu stok.</span>
        </div>
      </div>
    `;

  renderCart();
  renderPendingOrders();
  initIcons();
}

function setCategory(category) {
  currentCategory = category;
  renderSales();
}

function syncCartItem(item, product) {
  if (!item || !product) return;
  item.productId = product.id;
  item.name = product.name;
  item.price = Math.max(0, Number(product.price) || 0);
  item.image = getProductImage(product);
  item.qty = Math.max(0, Math.floor(Number(item.qty) || 0));
}

function addToCart(productId) {
  const product = products.find((item) => item.id === productId);
  if (!product || product.stock <= 0) { showToast('Stok produk habis', 'circle-alert'); return; }
  const targetCart = isAdmin() ? cashierCart : customerCart;
  const existingItem = targetCart.find((item) => item.productId === productId);
  if (existingItem) {
    if (existingItem.qty >= product.stock) { showToast('Jumlah melebihi stok', 'circle-alert'); return; }
    existingItem.qty += 1;
  } else targetCart.push({ productId, qty: 1 });
  syncCartItem(existingItem || targetCart[targetCart.length - 1], product);
  cart = cashierCart;
  saveState();
  if (isAdmin()) renderSales(); else renderCustomerCart();
  showToast(`${product.name} masuk ke keranjang`, 'shopping-cart');
}

function changeQty(productId, delta, cartType = isAdmin() ? 'cashier' : 'customer') {
  const targetCart = cartType === 'cashier' ? cashierCart : customerCart;
  const item = targetCart.find((entry) => entry.productId === productId);
  const product = products.find((entry) => entry.id === productId);
  const amount = Number(delta);
  if (!item || !product || !Number.isFinite(amount)) return;
  item.qty += amount;
  if (item.qty <= 0) targetCart.splice(targetCart.indexOf(item), 1);
  else if (item.qty > product.stock) { item.qty = product.stock; showToast('Jumlah maksimal sesuai stok', 'circle-alert'); }
  if (item.qty > 0) syncCartItem(item, product);
  cart = cashierCart;
  saveState();
  if (cartType === 'cashier') renderSales(); else renderCustomerCart();
}

function renderCart() {
  const targetCart = cashierCart;
  $('#cartItems').innerHTML = targetCart.length ? targetCart.map((item) => `
    <div class="cart-item"><img src="${escapeHtml(resolveImageSource(item.image))}" alt="${escapeHtml(item.name)}"><div><strong>${escapeHtml(item.name)}</strong><small>${money(item.price)} / item</small><div class="qty-control"><button type="button" data-action="change-qty" data-cart-type="cashier" data-id="${escapeHtml(item.productId)}" data-delta="-1"><i data-lucide="minus"></i></button><span>${item.qty}</span><button type="button" data-action="change-qty" data-cart-type="cashier" data-id="${escapeHtml(item.productId)}" data-delta="1"><i data-lucide="plus"></i></button></div></div><span class="price">${money(item.price * item.qty)}</span></div>`).join('') : `<div class="cart-empty"><div><i data-lucide="shopping-cart"></i><strong>Keranjang kasir masih kosong</strong><span>Ambil pesanan pelanggan atau pilih produk.</span></div></div>`;
  const subtotal = targetCart.reduce((t, item) => t + item.price * item.qty, 0); const tax = Math.round(subtotal * TAX_RATE); const total = subtotal + tax; const cashInput = $('#cashAmount')?.value || ''; const cash = Number(cashInput.replace(/\D/g, '')) || 0;
  $('#cartSubtotal').textContent = money(subtotal); $('#cartTax').textContent = money(tax); $('#cartTotal').textContent = money(total); $('#cashChange').textContent = money(Math.max(0, cash - total)); updateCartCount(); initIcons();
}

function renderCustomerCart() {
  const box = $('#customerCartItems'); if (!box) return;
  box.innerHTML = customerCart.length ? customerCart.map((item) => `
    <div class="cart-item"><img src="${escapeHtml(resolveImageSource(item.image))}" alt="${escapeHtml(item.name)}"><div><strong>${escapeHtml(item.name)}</strong><small>${money(item.price)} / item</small><div class="qty-control"><button type="button" data-action="change-qty" data-cart-type="customer" data-id="${escapeHtml(item.productId)}" data-delta="-1"><i data-lucide="minus"></i></button><span>${item.qty}</span><button type="button" data-action="change-qty" data-cart-type="customer" data-id="${escapeHtml(item.productId)}" data-delta="1"><i data-lucide="plus"></i></button></div></div><span class="price">${money(item.price * item.qty)}</span></div>`).join('') : `<div class="cart-empty"><div><i data-lucide="shopping-cart"></i><strong>Keranjang masih kosong</strong><span>Pilih produk di atas untuk menambahkannya.</span></div></div>`;
  const subtotal = customerCart.reduce((t, item) => t + item.price * item.qty, 0); const tax = Math.round(subtotal * TAX_RATE);
  $('#customerCartSubtotal').textContent = money(subtotal); $('#customerCartTax').textContent = money(tax); $('#customerCartTotal').textContent = money(subtotal + tax); $('#customerCheckoutButton').disabled = !customerCart.length; updateCartCount(); initIcons();
}

function calculateSaleFrom(cartSource) {
  const items = cartSource.map((item) => { const product = products.find((entry) => entry.id === item.productId); if (!product) return null; const qty = Math.max(0, Math.floor(Number(item.qty) || 0)); return qty > 0 ? { productId: product.id, qty, name: product.name, price: Math.max(0, Number(product.price) || 0), image: getProductImage(product) } : null; }).filter(Boolean);
  const subtotal = items.reduce((t, item) => t + item.price * item.qty, 0); const tax = Math.round(subtotal * TAX_RATE); return { items, subtotal, tax, total: subtotal + tax };
}

function checkoutCustomerOrder() {
  if (!customerCart.length) { showToast('Keranjang masih kosong', 'circle-alert'); return; }
  const { items, subtotal, tax, total } = calculateSaleFrom(customerCart);
  for (const item of items) {
    const product = products.find((entry) => entry.id === item.productId);
    if (!product || product.stock < item.qty) { showToast(`Stok ${item.name} tidak mencukupi`, 'circle-alert'); return; }
  }

  const now = new Date();
  const suffix = typeof crypto.randomUUID === 'function' ? crypto.randomUUID().slice(0, 6).toUpperCase() : Math.random().toString(36).slice(2, 8).toUpperCase();
  const order = {
    id: `ORD-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${suffix}`,
    createdAt: now.toISOString(),
    updatedAt: '',
    status: 'pending',
    editRequested: false,
    editUsed: false,
    appliedItems: [],
    items, subtotal, tax, total
  };

  customerOrders.unshift(JSON.parse(JSON.stringify(order)));
  pendingOrders.unshift(order);
  customerCart = [];
  saveState();
  renderCustomerCart();
  renderCustomerHistory();
  renderPendingOrders();
  showToast('Pesanan dikirim ke Kasir / Admin', 'send');
}

function orderEditRemaining(order) {
  const created = Date.parse(order?.createdAt || '');
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, EDIT_WINDOW_MS - (Date.now() - created));
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
}

function orderStatusLabel(order) {
  if (order.status === 'completed') return ['Selesai', 'status-good'];
  if (order.editRequested) return ['Perubahan dikirim', 'status-low'];
  if (order.status === 'accepted') return ['Diproses kasir', 'status-low'];
  return ['Menunggu kasir', 'status-low'];
}

function getHistoryDayKey(value) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return 'unknown';
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatHistoryDayLabel(key) {
  if (key === 'unknown') return 'Tanggal tidak diketahui';
  const [year, month, day] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date(year, month - 1, day));
}

function renderHistoryDaySeparator(label) {
  return `<div class="history-day-separator"><span></span><strong>${escapeHtml(label)}</strong><span></span></div>`;
}

function renderCustomerHistory() {
  const box = $('#customerHistoryList');
  if (!box) return;
  const rows = Array.isArray(customerOrders) ? customerOrders : [];
  const scrollHint = $('#customerHistoryScrollHint');
  box.classList.toggle('is-scrollable', rows.length > 1);
  if (scrollHint) scrollHint.hidden = rows.length <= 1;

  box.innerHTML = rows.length ? (() => {
    let lastDayKey = '';
    return rows.map((order) => {
      const dayKey = getHistoryDayKey(order.createdAt);
      const daySeparator = dayKey !== lastDayKey ? renderHistoryDaySeparator(formatHistoryDayLabel(dayKey)) : '';
      lastDayKey = dayKey;
      const remaining = orderEditRemaining(order);
      const canEdit = remaining > 0 && order.status !== 'completed' && !order.editUsed;
      const [label, klass] = orderStatusLabel(order);
      const totalQty = order.items.reduce((sum, item) => sum + item.qty, 0);
      const itemText = order.items.map((item) => `${escapeHtml(item.name)} ×${item.qty}`).join(' · ');

      let lockText = 'Waktu edit habis';
      if (order.status === 'completed') lockText = 'Transaksi selesai';
      else if (order.editUsed) lockText = 'Edit sudah digunakan';

      return `${daySeparator}<article class="customer-history-item" data-history-id="${escapeHtml(order.id)}">
        <div class="customer-history-head">
          <div><strong>${escapeHtml(order.id)}</strong><small>${escapeHtml(new Date(order.createdAt).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}))}</small></div>
          <span class="status ${klass}">${label}</span>
        </div>
        <div class="customer-history-items" title="${escapeHtml(itemText || 'Tidak ada item')}">${itemText || 'Tidak ada item'}</div>
        <div class="customer-history-foot">
          <div><strong>${money(order.total)}</strong><small>${totalQty} item</small></div>
          <div class="history-edit-area">
            ${canEdit
              ? `<span class="history-countdown" data-history-countdown="${escapeHtml(order.id)}"><i data-lucide="timer"></i><span>${formatCountdown(remaining)}</span></span>
                 <button class="secondary-button" type="button" data-action="edit-checkout" data-id="${escapeHtml(order.id)}"><i data-lucide="pencil"></i>Edit Pesanan</button>`
              : `<span class="history-locked"><i data-lucide="${order.editUsed ? 'check-circle-2' : 'lock-keyhole'}"></i>${lockText}</span>`}
          </div>
        </div>
      </article>`;
    }).join('');
  })() : `<div class="cart-empty compact-history-empty"><div><i data-lucide="history"></i><strong>Belum ada checkout</strong><span>Pesanan yang kamu kirim ke kasir akan muncul di sini.</span></div></div>`;

  initIcons();

  if (!customerHistoryTimer) {
    customerHistoryTimer = window.setInterval(() => {
      const now = Date.now();

      $$('#customerHistoryList [data-history-countdown]').forEach((badge) => {
        const order = customerOrders.find((entry) => entry.id === badge.dataset.historyCountdown);
        if (!order || order.editUsed || order.status === 'completed') return;
        const remainingNow = Math.max(0, EDIT_WINDOW_MS - (now - Date.parse(order.createdAt || '')));
        if (remainingNow <= 0) {
          renderCustomerHistory();
          return;
        }
        const text = badge.querySelector('span');
        if (text) text.textContent = formatCountdown(remainingNow);
      });

      customerOrders.forEach((order) => {
        if (!order.editUsed && order.status !== 'completed' && orderEditRemaining(order) <= 0) {
          const card = $(`[data-history-id="${CSS.escape(order.id)}"]`);
          if (card && card.querySelector('[data-action="edit-checkout"]')) {
            renderCustomerHistory();
          }
        }
      });
    }, 250);
  }
}

function openCheckoutEdit(orderId) {
  const order = customerOrders.find((entry) => entry.id === orderId);
  if (!order) return;

  const remaining = orderEditRemaining(order);
  if (remaining <= 0 || order.status === 'completed' || order.editUsed) {
    renderCustomerHistory();
    return;
  }

  checkoutEditOrderId = orderId;
  checkoutEditItems = order.items.map((item) => ({ ...item }));

  const modal = $('#checkoutEditModal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  document.body.classList.add('modal-open');
  renderCheckoutEditModal();

  clearInterval(checkoutEditTimer);
  checkoutEditTimer = window.setInterval(() => {
    const latest = customerOrders.find((entry) => entry.id === checkoutEditOrderId);
    const left = latest ? orderEditRemaining(latest) : 0;

    if (!latest || left <= 0 || latest.editUsed || latest.status === 'completed') {
      closeCheckoutEdit();
      renderCustomerHistory();
      return;
    }

    $('#checkoutEditTimer').textContent = formatCountdown(left);
    const save = $('#saveCheckoutEdit');
    if (save) save.disabled = false;
  }, 250);

  window.setTimeout(() => $('#saveCheckoutEdit')?.focus(), 60);
}

function getCheckoutEditTotals(items) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const tax = Math.round(subtotal * TAX_RATE);
  return { subtotal, tax, total: subtotal + tax };
}

function renderCheckoutEditModal() {
  const list = $('#checkoutEditList');
  const order = customerOrders.find((entry) => entry.id === checkoutEditOrderId);
  if (!list || !order) return;
  $('#checkoutEditTimer').textContent = formatCountdown(orderEditRemaining(order));
  const nextTotals = getCheckoutEditTotals(checkoutEditItems);
  const difference = nextTotals.total - order.total;
  const differenceLabel = difference === 0 ? 'Tidak ada perubahan' : `${difference > 0 ? '+' : '-'}${money(Math.abs(difference))}`;
  const differenceClass = difference === 0 ? 'checkout-edit-diff neutral' : difference > 0 ? 'checkout-edit-diff increase' : 'checkout-edit-diff decrease';
  const oldTotal = $('#checkoutEditOldTotal');
  const newTotal = $('#checkoutEditNewTotal');
  const diffTotal = $('#checkoutEditDifference');
  if (oldTotal) oldTotal.textContent = money(order.total);
  if (newTotal) newTotal.textContent = money(nextTotals.total);
  if (diffTotal) {
    diffTotal.textContent = differenceLabel;
    diffTotal.className = differenceClass;
  }
  list.innerHTML = checkoutEditItems.length ? checkoutEditItems.map((item) => {
    const product = products.find((entry) => entry.id === item.productId);
    const max = product ? product.stock : item.qty;
    return `<div class="checkout-edit-item"><img src="${escapeHtml(resolveImageSource(item.image))}" alt="${escapeHtml(item.name)}"><div class="checkout-edit-main"><strong>${escapeHtml(item.name)}</strong><small>${money(item.price)} / item · Maks ${max}</small></div><div class="qty-control checkout-edit-qty"><button type="button" data-action="edit-checkout-qty" data-id="${escapeHtml(item.productId)}" data-delta="-1"><i data-lucide="minus"></i></button><span>${item.qty}</span><button type="button" data-action="edit-checkout-qty" data-id="${escapeHtml(item.productId)}" data-delta="1"><i data-lucide="plus"></i></button></div></div>`;
  }).join('') : `<div class="cart-empty"><div><i data-lucide="package-x"></i><strong>Tidak ada item</strong><span>Minimal satu item harus tersisa.</span></div></div>`;
  initIcons();
}

function changeCheckoutEditQty(productId, delta) {
  const item = checkoutEditItems.find((entry) => entry.productId === productId);
  const product = products.find((entry) => entry.id === productId);
  if (!item || !product) return;
  const next = item.qty + Number(delta);
  if (next <= 0) {
    checkoutEditItems = checkoutEditItems.filter((entry) => entry.productId !== productId);
  } else if (next > product.stock) {
    showToast(`Jumlah ${product.name} melebihi stok`, 'circle-alert');
    return;
  } else {
    item.qty = next;
  }
  renderCheckoutEditModal();
}

function saveCheckoutEdit() {
  const order = customerOrders.find((entry) => entry.id === checkoutEditOrderId);
  if (!order) return;
  if (orderEditRemaining(order) <= 0 || order.editUsed || order.status === 'completed') { closeCheckoutEdit(); renderCustomerHistory(); return; }
  if (!checkoutEditItems.length) { showToast('Pesanan harus memiliki minimal satu item', 'circle-alert'); return; }

  const payload = checkoutEditItems.map((item) => {
    const product = products.find((entry) => entry.id === item.productId);
    return product ? { productId: product.id, name: product.name, qty: item.qty, price: product.price, image: getProductImage(product) } : null;
  }).filter(Boolean);
  const { subtotal, tax, total } = getCheckoutEditTotals(payload);
  order.items = payload; order.subtotal = subtotal; order.tax = tax; order.total = total; order.updatedAt = new Date().toISOString(); order.editRequested = true; order.editUsed = true;

  const pending = pendingOrders.find((entry) => entry.id === order.id);
  if (pending) { Object.assign(pending, JSON.parse(JSON.stringify(order))); }
  else { orderEditRequests.push(JSON.parse(JSON.stringify(order))); }
  saveState();
  closeCheckoutEdit();
  renderCustomerHistory();
  renderPendingOrders();
  showToast('Perubahan pesanan dikirim ke Kasir / Admin', 'send');
}

function closeCheckoutEdit() {
  clearInterval(checkoutEditTimer);
  checkoutEditTimer = null;
  checkoutEditOrderId = null;
  checkoutEditItems = [];
  const modal = $('#checkoutEditModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden','true');
  document.body.classList.remove('modal-open');
}

function renderPendingOrders() {
  const box = $('#pendingOrders'); if (!box) return; const visible = pendingOrders.filter((order) => ['pending','accepted'].includes(order.status));
  box.innerHTML = visible.length ? visible.map((order) => `<article class="pending-order"><div class="pending-order-head"><div><strong>${escapeHtml(order.id)}</strong><small>${escapeHtml(new Date(order.createdAt).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}))}</small></div><span class="status ${order.editRequested ? 'status-low' : 'status-low'}">${order.editRequested ? 'Perubahan Pesanan' : (order.status === 'accepted' ? 'Sedang Diproses' : 'Menunggu Kasir')}</span></div><div class="pending-order-items">${order.items.map((item) => `<span>${escapeHtml(item.name)} ×${item.qty}</span>`).join('')}</div><div class="pending-order-foot"><strong>${money(order.total)}</strong>${order.status === 'pending' ? `<button class="secondary-button" type="button" data-action="accept-pending-order" data-id="${escapeHtml(order.id)}"><i data-lucide="shopping-cart"></i>Ambil ke Keranjang Kasir</button>` : (order.editRequested ? `<button class="secondary-button" type="button" data-action="apply-order-edit" data-id="${escapeHtml(order.id)}"><i data-lucide="refresh-cw"></i>Terapkan Perubahan</button>` : `<span class="history-locked"><i data-lucide="check"></i>Sudah masuk keranjang kasir</span>`)}</div></article>`).join('') : `<div class="cart-empty"><div><i data-lucide="inbox"></i><strong>Belum ada pesanan pelanggan</strong><span>Checkout pelanggan akan muncul di sini.</span></div></div>`;
  updateCartCount(); initIcons();
}

function applyOrderEditToCashier(orderId) {
  if (!requireAdmin('menerapkan perubahan pesanan')) return;
  const order = pendingOrders.find((entry) => entry.id === orderId && entry.status === 'accepted' && entry.editRequested);
  if (!order) return;

  const previous = new Set((order.appliedItems?.length ? order.appliedItems : order.items).map((item) => item.productId));
  const nextCart = cashierCart.filter((item) => !previous.has(item.productId));
  for (const item of order.items) {
    const product = products.find((entry) => entry.id === item.productId);
    if (!product || product.stock < item.qty) {
      showToast(`Stok ${item.name} tidak mencukupi untuk perubahan`, 'circle-alert');
      return;
    }
    nextCart.push({ productId: item.productId, qty: item.qty });
  }
  cashierCart = nextCart.map((item) => {
    const product = products.find((entry) => entry.id === item.productId);
    if (product) syncCartItem(item, product);
    return item;
  });
  cart = cashierCart;
  order.editRequested = false;
  order.appliedItems = order.items.map((item) => ({ productId: item.productId, qty: item.qty }));
  const customerOrder = customerOrders.find((entry) => entry.id === orderId);
  if (customerOrder) customerOrder.editRequested = false;
  saveState();
  renderSales();
  renderPendingOrders();
  renderCustomerHistory();
  showToast(`Perubahan ${order.id} diterapkan ke keranjang kasir`, 'check');
}

function acceptPendingOrder(orderId) {
  if (!requireAdmin('menerima pesanan pelanggan')) return; const order = pendingOrders.find((entry) => entry.id === orderId && entry.status === 'pending'); if (!order) return;
  for (const item of order.items) { const product = products.find((entry) => entry.id === item.productId); if (!product || product.stock < item.qty) { showToast(`Stok ${item.name} tidak mencukupi`, 'circle-alert'); return; } }
  for (const item of order.items) {
    const product = products.find((entry) => entry.id === item.productId);
    const existing = cashierCart.find((entry) => entry.productId === item.productId);
    const combinedQty = (existing?.qty || 0) + item.qty;
    if (!product || combinedQty > product.stock) { showToast(`Jumlah ${item.name} akan melebihi stok kasir`, 'circle-alert'); return; }
  }
  for (const item of order.items) { const existing = cashierCart.find((entry) => entry.productId === item.productId); if (existing) existing.qty += item.qty; else cashierCart.push({ productId: item.productId, qty: item.qty }); const target = existing || cashierCart[cashierCart.length - 1]; const product = products.find((entry) => entry.id === item.productId); if (product) syncCartItem(target, product); }
  order.status = 'accepted'; order.editRequested = false; order.appliedItems = order.items.map((item) => ({ productId: item.productId, qty: item.qty })); const customerOrder = customerOrders.find((entry) => entry.id === order.id); if (customerOrder) { customerOrder.status = 'accepted'; customerOrder.editRequested = false; customerOrder.items = JSON.parse(JSON.stringify(order.items)); customerOrder.subtotal = order.subtotal; customerOrder.tax = order.tax; customerOrder.total = order.total; } cart = cashierCart; saveState(); renderPendingOrders(); renderSales(); showToast(`Pesanan ${order.id} masuk ke keranjang kasir`, 'shopping-cart');
}

function calculateSale() { const base = calculateSaleFrom(cashierCart); const rawCash = String($('#cashAmount').value || '').replace(/\D/g, ''); return { ...base, cash: Number(rawCash) || 0 }; }

function checkout() {
  if (!requireAdmin('menyelesaikan pembayaran')) return; if (checkoutBusy) return; if (!cashierCart.length) { showToast('Keranjang kasir masih kosong', 'circle-alert'); return; }
  const { items, subtotal, tax, total, cash } = calculateSale(); if (cash < total) { showToast('Uang bayar belum mencukupi', 'circle-alert'); return; }
  for (const item of items) { const product = products.find((entry) => entry.id === item.productId); if (!product || product.stock < item.qty) { showToast(`Stok ${item.name} tidak mencukupi`, 'circle-alert'); return; } }
  checkoutBusy = true; const checkoutButton = $('#checkoutButton'); if (checkoutButton) checkoutButton.disabled = true;
  try { const now = new Date(); const suffix = typeof crypto.randomUUID === 'function' ? crypto.randomUUID().slice(0,6).toUpperCase() : Math.random().toString(36).slice(2,8).toUpperCase(); const sale = { id:`TRX-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${suffix}`, date:now.toISOString(), dateLabel:now.toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}), items:items.map((item)=>({...item})), subtotal, tax, total, cash, change:cash-total };
    for (const item of items) { const product = products.find((entry)=>entry.id===item.productId); if (product) product.stock -= item.qty; }
    sales.unshift(sale); const sourceOrder = pendingOrders.find((order) => order.status === 'accepted' && order.items.some((pendingItem) => items.some((saleItem) => saleItem.productId === pendingItem.productId))); if (sourceOrder) { sourceOrder.status = 'completed'; sourceOrder.editRequested = false; const customerOrder = customerOrders.find((entry) => entry.id === sourceOrder.id); if (customerOrder) { customerOrder.status = 'completed'; customerOrder.editRequested = false; customerOrder.items = JSON.parse(JSON.stringify(items)); customerOrder.subtotal = subtotal; customerOrder.tax = tax; customerOrder.total = total; } } cashierCart=[]; cart=cashierCart; $('#cashAmount').value=''; saveState(); renderDashboard(); renderSales(); renderHistory(); renderCustomerHistory(); renderPendingOrders(); showReceiptPreview(sale); showToast('Pembayaran berhasil. Transaksi dicatat dan stok diperbarui.','badge-check');
  } finally { checkoutBusy=false; if (checkoutButton) checkoutButton.disabled=false; }
}

function buildReceiptMarkup(sale) {
  const items = (Array.isArray(sale.items) ? sale.items : []).map((item) => `
    <div class="receipt-row">
      <span>${escapeHtml(item.name)} ×${Number(item.qty) || 0}</span>
      <b>${money((Number(item.price) || 0) * (Number(item.qty) || 0))}</b>
    </div>
  `).join('');

  return `
    <div class="receipt-paper">
      <div class="receipt-brand">CafeBilling</div>
      <div class="receipt-subtitle">Point of Sale Simulation</div>
      <div class="receipt-meta">${escapeHtml(sale.dateLabel || '')}<br>${escapeHtml(sale.id || '')}</div>
      <div class="receipt-line"></div>
      ${items || '<div class="receipt-empty">Tidak ada item.</div>'}
      <div class="receipt-line"></div>
      <div class="receipt-row"><span>Subtotal</span><b>${money(sale.subtotal)}</b></div>
      <div class="receipt-row"><span>Pajak</span><b>${money(sale.tax)}</b></div>
      <div class="receipt-row receipt-total"><span>Total</span><b>${money(sale.total)}</b></div>
      <div class="receipt-line"></div>
      <div class="receipt-row"><span>Bayar</span><b>${money(sale.cash)}</b></div>
      <div class="receipt-row"><span>Kembali</span><b>${money(sale.change)}</b></div>
      <div class="receipt-line"></div>
      <div class="receipt-footer">Terima kasih telah berbelanja ✦</div>
    </div>
  `;
}

function buildReceiptDocument(sale) {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(sale.id || 'CafeBilling')}</title>
<style>
*{box-sizing:border-box}
body{margin:0;padding:24px;background:#f6f7fb;color:#172033;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.receipt-paper{width:min(100%,380px);margin:auto;padding:24px;background:#fff;border:1px solid #e8ebf2;border-radius:20px;box-shadow:0 18px 50px rgba(20,31,56,.08)}
.receipt-brand{text-align:center;font-size:24px;font-weight:800}.receipt-subtitle,.receipt-meta,.receipt-footer{text-align:center;color:#748099;font-size:12px;line-height:1.6}
.receipt-meta{margin-top:5px}.receipt-line{margin:15px 0;border-top:1px dashed #ccd2dc}.receipt-row{display:flex;justify-content:space-between;gap:16px;margin:9px 0;font-size:13px}.receipt-total{font-size:18px;font-weight:800}.receipt-empty{text-align:center;color:#748099}
@media print{body{padding:0;background:#fff}.receipt-paper{width:100%;border:0;border-radius:0;box-shadow:none;padding:0}}
</style>
</head>
<body>${buildReceiptMarkup(sale)}</body>
</html>`;
}

function showReceiptPreview(sale) {
  if (!requireAdmin('membuka bukti pembayaran')) return;
  if (!sale) return;

  const modal = $('#receiptPreviewModal');
  const content = $('#receiptPreviewContent');
  if (!modal || !content) return;

  activeReceipt = JSON.parse(JSON.stringify(sale));
  content.innerHTML = buildReceiptMarkup(activeReceipt);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  initIcons();
}

function closeReceiptPreview() {
  const modal = $('#receiptPreviewModal');
  if (!modal) return;

  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  activeReceipt = null;
}

function downloadReceipt() {
  if (!requireAdmin('mengunduh bukti pembayaran')) return;
  if (!activeReceipt) return;

  const blob = new Blob([buildReceiptDocument(activeReceipt)], {
    type: 'text/html;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = `${activeReceipt.id || 'cafebilling-receipt'}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Bukti pembayaran berhasil diunduh', 'download');
}

function printActiveReceipt() {
  if (!requireAdmin('mencetak bukti pembayaran')) return;
  if (!activeReceipt) return;

  const receiptWindow = window.open('', '_blank', 'width=430,height=760');
  if (!receiptWindow) {
    showToast('Popup diblokir browser', 'circle-alert');
    return;
  }

  receiptWindow.document.open();
  receiptWindow.document.write(buildReceiptDocument(activeReceipt));
  receiptWindow.document.close();
  receiptWindow.focus();
  window.setTimeout(() => receiptWindow.print(), 150);
}

function previewReceipt(sale) {
  showReceiptPreview(sale);
}

function renderHistory() {
  if (!isAdmin()) return;
  const query = ($('#historySearch').value || '').toLowerCase().trim();
  const filteredSales = sales.filter((sale) => {
    const target = `${sale.id} ${sale.dateLabel}`.toLowerCase();
    return target.includes(query);
  });

  $('#historyCount').textContent = `${filteredSales.length} transaksi`;

  $('#historyBody').innerHTML = filteredSales.length
    ? (() => {
      let lastDayKey = '';
      return filteredSales.map((sale) => {
        const dayKey = getHistoryDayKey(sale.date || sale.dateLabel);
        const daySeparator = dayKey !== lastDayKey
          ? `<tr class="history-day-row"><td colspan="6">${renderHistoryDaySeparator(formatHistoryDayLabel(dayKey))}</td></tr>`
          : '';
        lastDayKey = dayKey;
        return `${daySeparator}
          <tr>
            <td><strong>${escapeHtml(sale.id)}</strong></td>
            <td>${escapeHtml(sale.dateLabel)}</td>
            <td>${sale.items.reduce((total, item) => total + item.qty, 0)} item</td>
            <td><strong>${money(sale.total)}</strong></td>
            <td>${money(sale.cash)}</td>
            <td>
              <button class="icon-button" type="button" data-action="reprint-sale" data-id="${escapeHtml(sale.id)}" title="Cetak ulang">
                <i data-lucide="printer"></i>
              </button>
            </td>
          </tr>`;
      }).join('');
    })()
    : `
      <tr>
        <td colspan="6">
          <div class="cart-empty">
            <div>
              <i data-lucide="file-x-2"></i>
              <strong>Belum ada riwayat</strong>
              <span>Transaksi yang selesai akan tampil di sini.</span>
            </div>
          </div>
        </td>
      </tr>
    `;

  initIcons();
}

function reprintSale(id) {
  if (!requireAdmin('mencetak bukti transaksi')) return;
  const sale = sales.find((entry) => entry.id === id);
  if (sale) previewReceipt(sale);
}

function openProductModal(product) {
  if (!requireAdmin('mengelola produk')) return;
  $('#productModal').classList.add('open');
  $('#productModalTitle').textContent = product ? 'Edit Produk' : 'Tambah Produk';
  $('#productId').value = product?.id || '';
  $('#productName').value = product?.name || '';
  $('#productCategory').value = product?.category || 'Kopi';
  $('#productPrice').value = product?.price || '';
  $('#productStock').value = product?.stock ?? '';
  $('#productImage').value = product?.image && /^https:\/\//i.test(product.image) ? product.image : '';
  setProductImageCheck('hidden');
  if ($('#productImage').value) window.setTimeout(previewProductImageUrl, 0);

  window.setTimeout(() => $('#productName').focus(), 60);
}

function closeProductModal() {
  $('#productModal').classList.remove('open');
}

function editProduct(id) {
  if (!requireAdmin('mengedit produk')) return;
  const product = products.find((entry) => entry.id === id);
  if (product) openProductModal(product);
}

let pendingConfirmAction = null;

function openConfirmModal({ title = 'Konfirmasi', message = '', confirmLabel = 'Lanjutkan', danger = false, onConfirm }) {
  const modal = $('#confirmModal');
  if (!modal) return;

  pendingConfirmAction = typeof onConfirm === 'function' ? onConfirm : null;
  $('#confirmModalTitle').textContent = title;
  $('#confirmModalMessage').textContent = message;

  const action = $('#confirmModalAction');
  action.textContent = confirmLabel;
  action.classList.toggle('danger-button', danger);

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  window.setTimeout(() => action.focus(), 60);
}

function closeConfirmModal() {
  const modal = $('#confirmModal');
  if (!modal) return;

  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  pendingConfirmAction = null;
}

function handleConfirmAction() {
  const action = pendingConfirmAction;
  closeConfirmModal();
  if (action) action();
}

function deleteProduct(id) {
  if (!requireAdmin('menghapus produk')) return;
  const product = products.find((entry) => entry.id === id);

  if (!product) return;

  if (cart.some((item) => item.productId === id)) {
    showToast('Hapus produk dari keranjang terlebih dahulu', 'circle-alert');
    return;
  }

  openConfirmModal({
    title: 'Hapus Produk',
    message: `Produk "${product.name}" akan dihapus dari katalog. Tindakan ini tidak dapat dibatalkan.`,
    confirmLabel: 'Hapus Produk',
    danger: true,
    onConfirm: () => {
      products = products.filter((entry) => entry.id !== id);
      saveState();
      renderInventory();
      renderDashboard();
      renderCatalog();
      showToast('Produk dihapus', 'trash-2');
    }
  });
}

function validateRemoteImage(url) {
  const value = String(url || '').trim();
  if (!value) return Promise.resolve(true);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return Promise.resolve(false);
  }
  if (parsed.protocol !== 'https:') return Promise.resolve(false);
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = window.setTimeout(() => finish(false), 8000);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = value;
  });
}

function setProductImageCheck(state, message = '') {
  const box = $('#productImageCheck');
  const image = $('#productImagePreview');
  const title = $('#productImageCheckTitle');
  const status = $('#productImageCheckStatus');
  if (!box || !image || !title || !status) return;
  if (state === 'hidden') {
    box.hidden = true;
    image.removeAttribute('src');
    box.dataset.state = '';
    return;
  }
  box.hidden = false;
  box.dataset.state = state;
  status.textContent = message;
  title.textContent = state === 'success' ? 'Gambar siap digunakan' : state === 'loading' ? 'Memeriksa gambar' : 'URL gambar tidak dapat digunakan';
}

async function previewProductImageUrl() {
  const input = $('#productImage');
  const image = $('#productImagePreview');
  if (!input || !image) return;
  const value = input.value.trim();
  if (!value) {
    setProductImageCheck('hidden');
    return;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    setProductImageCheck('error', 'Masukkan URL gambar yang valid.');
    return;
  }
  if (parsed.protocol !== 'https:') {
    setProductImageCheck('error', 'Gunakan tautan HTTPS agar gambar dapat dimuat dengan aman.');
    return;
  }
  setProductImageCheck('loading', 'Mencoba memuat gambar dari URL tersebut…');
  image.onload = () => setProductImageCheck('success', 'Gambar berhasil dimuat dari URL.');
  image.onerror = () => setProductImageCheck('error', 'Gambar gagal dimuat dari URL tersebut.');
  image.src = value;
}

async function saveProduct(event) {
  event.preventDefault();
  if (!requireAdmin('menyimpan perubahan produk')) return;

  const id = $('#productId').value.trim();
  const name = $('#productName').value.trim();
  const category = $('#productCategory').value;
  const price = Number($('#productPrice').value);
  const stock = Number($('#productStock').value);
  const enteredImage = $('#productImage').value.trim();
  const image = enteredImage ? safeImage(enteredImage) : getBuiltinProductAsset({ name }) || DEFAULT_IMAGE;

  if (!name || !Number.isFinite(price) || price < 0 || !Number.isFinite(stock) || stock < 0 || !Number.isInteger(stock)) {
    showToast('Periksa nama, harga, dan stok produk', 'circle-alert');
    return;
  }

  if (enteredImage) {
    const validImage = await validateRemoteImage(enteredImage);
    if (!validImage) {
      setProductImageCheck('error', 'Gambar tidak berhasil dimuat. Periksa URL dan coba lagi.');
      showToast('URL gambar tidak dapat dimuat', 'image-off');
      return;
    }
  }

  const productData = { name, category, price, stock, image };

  if (id) {
    const product = products.find((entry) => entry.id === id);
    if (product) Object.assign(product, productData);
    showToast('Produk berhasil diperbarui', 'save');
  } else {
    products.unshift({ id: makeId(), ...productData });
    showToast('Produk berhasil ditambahkan', 'package-plus');
  }

  saveState();
  closeProductModal();
  renderInventory();
  renderDashboard();
  renderSales();
  renderCatalog();
}

async function loadContributors(force = false) {
  if (contributorsLoaded && !force) return false;
  const status = $('#apiStatus');
  const list = $('#contributorList');

  status.innerHTML = '<i data-lucide="loader-circle"></i> Memuat';
  initIcons();

  const fetchContributors = async () => {
    const all = [];
    for (let page = 1; page <= 10; page += 1) {
      const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contributors?anon=true&per_page=100&page=${page}`, {
        headers: { Accept: 'application/vnd.github+json' },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error('Contributor API error');
      const batch = await response.json();
      if (!Array.isArray(batch)) throw new Error('Invalid contributor payload');
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all;
  };

  return fetchContributors()
    .then((contributors) => {
      if (!contributors.length) {
        list.innerHTML = `
          <div class="cart-empty">
            <div>
              <i data-lucide="users"></i>
              <strong>Belum ada contributor</strong>
              <span>GitHub belum mengembalikan data contributor.</span>
            </div>
          </div>
        `;
      } else {
        list.innerHTML = contributors.map((contributor) => {
          const login = contributor.login || 'anonymous';
          const avatar = contributor.avatar_url || 'https://github.com/github.png';
          const url = contributor.html_url || `https://github.com/${encodeURIComponent(login)}`;
          const contributions = Number(contributor.contributions || 0);

          const isMainDeveloper = login.toLowerCase() === 'ridhoae303';
          const role = isMainDeveloper ? 'Main Developer' : 'Contributor';

          return `
            <a
              class="contributor-item${isMainDeveloper ? ' main-developer' : ''}"
              href="${escapeHtml(url)}"
              target="_blank"
              rel="noopener noreferrer"
            >
              <img src="${escapeHtml(avatar)}" alt="${escapeHtml(login)}">
              <div>
                <strong>${escapeHtml(login)}</strong>
                <span>${role}</span>
              </div>
              <b class="contributor-count">${contributions}</b>
            </a>
          `;
        }).join('');
      }

      contributorsLoaded = true;
      status.innerHTML = `
        <i data-lucide="circle-check"></i>
        ${contributors.length} ditemukan
      `;
      initIcons();
      return true;
    })
    .catch(() => {
      list.innerHTML = `
        <div class="cart-empty">
          <div>
            <i data-lucide="wifi-off"></i>
            <strong>Data contributor belum tersedia</strong>
            <span>Pastikan repository publik dan browser dapat mengakses GitHub API.</span>
          </div>
        </div>
      `;
      status.innerHTML = '<i data-lucide="circle-alert"></i> Tidak tersedia';
      initIcons();
      return false;
    });
}

function openImagePreview(source, alt = 'Image Preview') {
  const modal = $('#imagePreviewModal');
  const image = $('#imagePreview');
  const caption = $('#imagePreviewCaption');

  if (!modal || !image) return;

  image.onerror = () => {
    image.onerror = null;

    if (image.dataset.developer === 'true') {
      image.src = DEVELOPER_AVATAR;
      return;
    }

    image.src = DEFAULT_IMAGE;
  };

  image.dataset.developer = source.includes('assets/developer.jpg') ? 'true' : 'false';
  image.src = source;
  image.alt = alt;
  caption.textContent = alt || 'Image Preview';

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('preview-open');
  initIcons();
}

function closeImagePreview() {
  const modal = $('#imagePreviewModal');
  if (!modal) return;

  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('preview-open');
}

function setMobileNavigation(open) {
  const sidebar = $('#sidebar');
  const backdrop = $('#sidebarBackdrop');
  const menuToggle = $('#menuToggle');

  if (!sidebar || !backdrop || !menuToggle) return;

  const isMobile = window.innerWidth <= 860;
  const shouldOpen = isMobile && open;

  sidebar.classList.toggle('open', shouldOpen);
  backdrop.classList.toggle('open', shouldOpen);
  backdrop.setAttribute('aria-hidden', String(!shouldOpen));
  menuToggle.setAttribute('aria-expanded', String(shouldOpen));
  document.body.classList.toggle('nav-open', shouldOpen);
}

function closeMobileNavigation() {
  setMobileNavigation(false);
}


function bindAuth() {
  refreshAccessUI();

  $('#authNavButton').addEventListener('click', handleAuthNavigation);
  $('#loginForm').addEventListener('submit', handleAdminLogin);
  $('#closeLoginModal').addEventListener('click', closeLoginModal);
  $('#cancelLogin').addEventListener('click', () => closeLoginModal(true));

  const passwordToggle = $('#toggleAdminPassword');
  if (passwordToggle) {
    passwordToggle.addEventListener('click', () => {
      const input = $('#adminPassword');
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      passwordToggle.setAttribute('aria-pressed', String(!visible));
      passwordToggle.setAttribute('aria-label', visible ? 'Tampilkan password' : 'Sembunyikan password');
      passwordToggle.setAttribute('title', visible ? 'Tampilkan password' : 'Sembunyikan password');
      const icon = passwordToggle.querySelector('[data-lucide],svg');
      if (icon) {
        if (icon.tagName.toLowerCase() === 'svg') icon.removeAttribute('data-lucide');
      }
      passwordToggle.innerHTML = `<i data-lucide="${visible ? 'eye' : 'eye-off'}"></i>`;
      initIcons();
    });
  }

  $('#closeReceiptPreview').addEventListener('click', closeReceiptPreview);
  $('#downloadReceipt').addEventListener('click', downloadReceipt);
  $('#printReceipt').addEventListener('click', printActiveReceipt);

  $('#receiptPreviewModal').addEventListener('click', (event) => {
    if (event.target.id === 'receiptPreviewModal') closeReceiptPreview();
  });

  $('#loginModal').addEventListener('click', (event) => {
    if (event.target.id === 'loginModal') closeLoginModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeLoginModal();
    closeReceiptPreview();
    closeConfirmModal();
    closeCheckoutEdit();
  });
}

function bindTheme() {
  applyTheme(document.documentElement.dataset.theme || getSavedTheme(), false);
  const toggle = $('#themeToggle');
  if (toggle) {
    toggle.onclick = toggleTheme;
  }
}

function bindNavigation() {
  document.addEventListener('click', (event) => {
    const viewTrigger = event.target.closest('[data-view]');
    if (!viewTrigger) return;

    event.preventDefault();
    setView(viewTrigger.dataset.view);
  });

  $('#menuToggle').addEventListener('click', () => {
    const sidebar = $('#sidebar');
    setMobileNavigation(!sidebar.classList.contains('open'));
  });

  $('#sidebarBackdrop').addEventListener('click', closeMobileNavigation);

  window.addEventListener('resize', () => {
    if (window.innerWidth > 860) closeMobileNavigation();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMobileNavigation();
  });
}

function bindProductImagePreview() {
  const input = $('#productImage');
  if (!input) return;
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(previewProductImageUrl, 260);
  });
}

function bindInventory() {
  $('#openProductModal').addEventListener('click', () => openProductModal());
  $('#productForm').addEventListener('submit', saveProduct);
  $('#inventorySearch').addEventListener('input', renderInventory);

  $$('.modal [data-close-modal="productModal"]').forEach((button) => {
    button.addEventListener('click', closeProductModal);
  });

  $('#productModal').addEventListener('click', (event) => {
    if (event.target.id === 'productModal') closeProductModal();
  });
}

function bindSales() {
  $('#salesSearch').addEventListener('input', renderSales);

  $('#cashAmount').addEventListener('input', (event) => {
    event.target.value = event.target.value.replace(/\D/g, '');
    renderCart();
  });

  $('#checkoutButton').addEventListener('click', checkout);
  $('#customerCheckoutButton').addEventListener('click', checkoutCustomerOrder);
  $('#clearCustomerCart').addEventListener('click', () => { if (!customerCart.length) return; openConfirmModal({ title: 'Kosongkan Keranjang', message: 'Semua item pada keranjang pelanggan akan dihapus.', confirmLabel: 'Kosongkan', danger: true, onConfirm: () => { customerCart = []; saveState(); renderCustomerCart(); showToast('Keranjang pelanggan dikosongkan', 'trash-2'); } }); });
  $('#closeCheckoutEdit')?.addEventListener('click', closeCheckoutEdit);
  $('#cancelCheckoutEdit')?.addEventListener('click', closeCheckoutEdit);
  $('#saveCheckoutEdit')?.addEventListener('click', saveCheckoutEdit);
  $('#checkoutEditModal')?.addEventListener('click', (event) => { if (event.target.id === 'checkoutEditModal') closeCheckoutEdit(); });

  $('#clearCart').addEventListener('click', () => {
    if (!requireAdmin('mengosongkan keranjang kasir')) return;
    if (!cart.length) return;
    openConfirmModal({
      title: 'Kosongkan Keranjang',
      message: 'Semua item pada keranjang kasir akan dihapus.',
      confirmLabel: 'Kosongkan',
      danger: true,
      onConfirm: () => {
        cashierCart = [];
        cart = cashierCart;
        saveState();
        renderSales();
        showToast('Keranjang dikosongkan', 'trash-2');
      }
    });
  });

  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;

    event.preventDefault();
    setView('sales');
    window.setTimeout(() => $('#salesSearch').focus(), 100);
  });
}

function bindHistory() {
  const input = $('#historySearch');
  if (input) input.addEventListener('input', renderHistory);
}

function bindCatalog() {
  const search = $('#catalogSearch');
  if (search) search.addEventListener('input', renderCatalog);
}

function bindQuickActions() {
  $$('.quick-card').forEach((card) => {
    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      card.style.setProperty('--pointer-x', `${x}%`);
      card.style.setProperty('--pointer-y', `${y}%`);
    });
    card.addEventListener('pointerleave', () => {
      card.style.removeProperty('--pointer-x');
      card.style.removeProperty('--pointer-y');
    });
    card.addEventListener('pointerdown', () => {
      card.classList.remove('is-pressed');
      void card.offsetWidth;
      card.classList.add('is-pressed');
    });
    card.addEventListener('animationend', (event) => {
      if (event.animationName === 'quickCardPress') card.classList.remove('is-pressed');
    });
  });
}

function bindDeveloper() {
  const refreshButton = $('#refreshContributors');
  if (!refreshButton) return;

  refreshButton.addEventListener('click', async () => {
    if (refreshButton.dataset.loading === 'true') return;

    refreshButton.dataset.loading = 'true';
    refreshButton.disabled = true;
    refreshButton.setAttribute('aria-busy', 'true');
    refreshButton.classList.add('is-loading');

    try {
      await loadContributors(true);
    } finally {
      refreshButton.dataset.loading = 'false';
      refreshButton.disabled = false;
      refreshButton.removeAttribute('aria-busy');
      refreshButton.classList.remove('is-loading');
      initIcons();
    }
  });
}

function bindReset() {
  $('#resetData').addEventListener('click', () => {
    if (!requireAdmin('mereset data demo')) return;
    openConfirmModal({
      title: 'Reset Data Demo',
      message: 'Produk, stok, keranjang, dan riwayat transaksi akan dikembalikan ke data awal.',
      confirmLabel: 'Reset Data',
      danger: true,
      onConfirm: () => {
        localStorage.removeItem(STORAGE_KEY);
        products = BUILTIN_PRODUCTS.map((product) => ({
          ...product,
          id: makeId(),
          image: product.image
        }));
        sales = [];
        customerCart = [];
        customerOrders = [];
        cashierCart = [];
        pendingOrders = [];
        orderEditRequests = [];
        cart = cashierCart;

        saveState();
        renderDashboard();
        renderCatalog();
        renderHistory();
        renderCustomerHistory();
        renderPendingOrders();
        setView('dashboard');
        showToast('Data demo dikembalikan', 'rotate-ccw');
      }
    });
  });
}

function bindConfirmModal() {
  $('#closeConfirmModal')?.addEventListener('click', closeConfirmModal);
  $('#cancelConfirmModal')?.addEventListener('click', closeConfirmModal);
  $('#confirmModalAction')?.addEventListener('click', handleConfirmAction);
  $('#confirmModal')?.addEventListener('click', (event) => {
    if (event.target.id === 'confirmModal') closeConfirmModal();
  });
}

function bindActionHandlers() {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const trigger = event.target.closest('.product-card[data-action="add-to-cart"], .catalog-card[data-action="add-customer-cart"]');
    if (!trigger || trigger.getAttribute('aria-disabled') === 'true') return;
    if (event.target.closest('button, a, input, select, textarea')) return;

    event.preventDefault();
    addToCart(trigger.dataset.id);
  });

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-action]');
    if (!trigger) return;

    const { action } = trigger.dataset;

    if (action === 'edit-product') {
      editProduct(trigger.dataset.id);
      return;
    }

    if (action === 'delete-product') {
      deleteProduct(trigger.dataset.id);
      return;
    }

    if (action === 'set-category') {
      setCategory(trigger.dataset.category);
      return;
    }

    if (action === 'set-catalog-category') {
      window.catalogCategory = trigger.dataset.category;
      renderCatalog();
      return;
    }

    if (action === 'add-to-cart' || action === 'add-customer-cart') return;

    if (action === 'accept-pending-order') { acceptPendingOrder(trigger.dataset.id); return; }

    if (action === 'apply-order-edit') { applyOrderEditToCashier(trigger.dataset.id); return; }

    if (action === 'edit-checkout') { openCheckoutEdit(trigger.dataset.id); return; }

    if (action === 'edit-checkout-qty') { changeCheckoutEditQty(trigger.dataset.id, Number(trigger.dataset.delta)); return; }

    if (action === 'change-qty') {
      changeQty(trigger.dataset.id, Number(trigger.dataset.delta), trigger.dataset.cartType || (isAdmin() ? 'cashier' : 'customer'));
      return;
    }

    if (action === 'reprint-sale') {
      reprintSale(trigger.dataset.id);
    }
  });
}

function bindImagePreview() {
  const modal = $('#imagePreviewModal');

  $('#closeImagePreview').addEventListener('click', closeImagePreview);

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeImagePreview();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeImagePreview();
  });

  document.addEventListener('click', (event) => {
    const previewTrigger = event.target.closest('[data-preview-src]');

    if (previewTrigger) {
      event.preventDefault();
      event.stopPropagation();
      openImagePreview(
        previewTrigger.dataset.previewSrc,
        previewTrigger.dataset.previewAlt || 'Image Preview'
      );
      return;
    }

    const image = event.target.closest('img');
    if (image && image.closest('.product-card, .catalog-card, .customer-developer-card')) return;
    if (image && !image.closest('#imagePreviewModal')) {
      event.preventDefault();
      event.stopPropagation();
      openImagePreview(image.currentSrc || image.src, image.alt || 'Image Preview');
      return;
    }

    const anchor = event.target.closest('a[href]');
    if (!anchor || anchor.closest('#imagePreviewModal')) return;

    const href = anchor.href || '';
    const isImage = /\.(avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(href);

    if (!isImage) return;

    event.preventDefault();
    openImagePreview(
      href,
      anchor.dataset.previewAlt || anchor.querySelector('img')?.alt || 'Image Preview'
    );
  });
}

function bindProductSelection() {
  const selector = '.product-card[data-action="add-to-cart"], .catalog-card[data-action="add-customer-cart"]';
  let timer = null; let longPressed = false;
  const clearPress = () => { if (timer) { clearTimeout(timer); timer = null; } };
  document.addEventListener('pointerdown', (event) => { const card = event.target.closest(selector); if (!card || card.getAttribute('aria-disabled') === 'true') return; longPressed=false; clearPress(); timer=setTimeout(()=>{ longPressed=true; const image=card.querySelector('img'); if(image) openImagePreview(image.currentSrc || image.src, image.alt || 'Image Preview'); },3500); }, true);
  ['pointerup','pointercancel','pointerleave'].forEach((name)=>document.addEventListener(name, clearPress, true));
  document.addEventListener('contextmenu', (event) => {
    if (event.target.closest(selector)) event.preventDefault();
  }, true);
  document.addEventListener('click',(event)=>{ const card=event.target.closest(selector); if(!card || card.getAttribute('aria-disabled')==='true') return; if(longPressed){ longPressed=false; event.preventDefault(); event.stopPropagation(); return; } if(!event.target.closest('button,a,input,select,textarea')) addToCart(card.dataset.id); });
}

function bindBrokenImages() {
  document.addEventListener('error', (event) => {
    const image = event.target;

    if (image.tagName !== 'IMG' || image.dataset.fallback) return;

    image.dataset.fallback = '1';

    const builtinSource = BUILTIN_PRODUCT_IMAGES[image.dataset.productImageKey || productImageKey(image.alt)];
    if (builtinSource) {
      image.src = resolveImageSource(builtinSource);
      return;
    }

    if (image.dataset.fallbackSrc) {
      image.src = image.dataset.fallbackSrc;
      return;
    }

    if (image.id === 'developerAvatar' || image.closest('.profile-chip') || image.closest('.avatar-preview')) {
      image.src = DEVELOPER_AVATAR;
    } else if (!image.dataset.productImageKey) {
      image.src = DEFAULT_IMAGE;
    }
  }, true);
}

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try {
    const next = JSON.parse(event.newValue);
    if (!next || typeof next !== 'object') return;
    products = Array.isArray(next.products) ? next.products.map(normalizeProduct).filter(Boolean) : products;
    sales = Array.isArray(next.sales) ? next.sales.map(normalizeSale).filter(Boolean) : sales;
    customerCart = Array.isArray(next.customerCart) ? next.customerCart.map(normalizeCartItem).filter(Boolean) : customerCart;
    customerOrders = Array.isArray(next.customerOrders) ? next.customerOrders.map(normalizePendingOrder).filter(Boolean) : customerOrders;
    cashierCart = Array.isArray(next.cashierCart) ? next.cashierCart.map(normalizeCartItem).filter(Boolean) : cashierCart;
    pendingOrders = Array.isArray(next.pendingOrders) ? next.pendingOrders.map(normalizePendingOrder).filter(Boolean) : pendingOrders;
    orderEditRequests = Array.isArray(next.orderEditRequests) ? next.orderEditRequests.map(normalizePendingOrder).filter(Boolean) : orderEditRequests;
    cart = cashierCart;
    renderDashboard(); renderCatalog(); renderCustomerCart(); renderCustomerHistory(); if (isAdmin()) renderSales(); renderPendingOrders();
  } catch {}
});

function handleAdminRoute() {
  if (!isAdminRoute()) return false;
  if (!isAdmin()) {
    setView('catalog');
    window.setTimeout(() => openLoginModal('mengakses halaman Admin'), 80);
    return true;
  }
  setView('dashboard');
  return true;
}

function boot() {
  bindAuth();
  bindTheme();
  bindNavigation();
  bindInventory();
  bindSales();
  bindHistory();
  bindCatalog();
  bindDeveloper();
  bindProductImagePreview();
  bindQuickActions();
  bindReset();
  bindConfirmModal();
  bindActionHandlers();
  bindImagePreview();
  bindProductSelection();
  bindBrokenImages();

  updateClock();
  window.setInterval(updateClock, 1000);

  const savedView = getSavedView();
  const firstView = isAdmin() ? ((['dashboard','inventory','sales','history','developer'].includes(savedView)) ? savedView : 'dashboard') : 'catalog';
  setView(firstView);
  handleAdminRoute();
  renderCustomerCart();
  renderCustomerHistory();
  renderPendingOrders();
  window.requestAnimationFrame(() => window.scrollTo(0, 0));
  initIcons();
}

boot();
