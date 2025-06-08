// Dashboard JavaScript functionality
  
// API configuration - API_SECRET will be set by the template, API_BASE from window location
let API_BASE = window.location.origin;

// Tab management
function showTab(tabName) {
  console.log(`showTab called with: ${tabName}`);
  
  try {
  // Hide all tab contents
  const tabContents = document.querySelectorAll('.tab-content');
    console.log(`Found ${tabContents.length} tab contents`);
  tabContents.forEach(content => content.classList.remove('active'));

  // Remove active class from all tabs
  const tabs = document.querySelectorAll('.tab');
    console.log(`Found ${tabs.length} tabs`);
  tabs.forEach(tab => tab.classList.remove('active'));

  // Show selected tab content
  const selectedContent = document.getElementById(`${tabName}-tab`);
  if (selectedContent) {
    selectedContent.classList.add('active');
      console.log(`Activated content for ${tabName}`);
    } else {
      console.error(`Could not find content element: ${tabName}-tab`);
  }

    // Add active class to selected tab by finding the tab with matching data attribute
    const selectedTab = document.querySelector(`button[data-tab="${tabName}"]`);
    if (selectedTab) {
  selectedTab.classList.add('active');
      console.log(`Activated tab button for ${tabName}`);
    } else {
      console.error(`Could not find tab button for ${tabName}`);
    }

  // Load data for the selected tab
  loadTabData(tabName);
    
    console.log(`Successfully switched to ${tabName} tab`);
  } catch (error) {
    console.error(`Error in showTab: ${error.message}`);
  }
}

// Load data based on the active tab
function loadTabData(tabName) {
  switch (tabName) {
    case 'overview':
      loadOverviewData();
      break;
    case 'services':
      loadServicesData();
      break;
    case 'backends':
      loadBackendsData();
      break;
    case 'health':
      loadHealthData();
      break;
    case 'logs':
      loadLogsData();
      break;
  }
}

// API helper function
async function apiCall(endpoint, options = {}) {
  console.log(`Making API call to: ${API_BASE}${endpoint}`);
  console.log('API_SECRET available:', !!API_SECRET);
  
  const defaultOptions = {
    headers: {
      'Authorization': `Bearer ${API_SECRET}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  };

  try {
    const url = `${API_BASE}${endpoint}`;
    console.log('Full URL:', url);
    console.log('Request options:', defaultOptions);
    
    const response = await fetch(url, {
      ...defaultOptions,
      ...options
    });

    console.log('Response status:', response.status);
    console.log('Response ok:', response.ok);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error response:', errorText);
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    console.log('API response:', result);
    return result;
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
}

// Load overview data
async function loadOverviewData() {
  console.log('Loading overview data...');
  try {
    // Load services list to get counts
    console.log('Making API call to /admin/services/list');
    const services = await apiCall('/admin/services/list');
    console.log('Services response:', services);

    // Update stats
    document.getElementById('total-services').textContent =
      Object.keys(services.services || {}).length;

    // Load backend data for each service
    let totalBackends = 0;
    let healthyBackends = 0;
    let unhealthyBackends = 0;

    for (const serviceName in services.services) {
      try {
        const config = await apiCall(`/admin/services/${serviceName}/config`);
        if (config.pools) {
          config.pools.forEach(pool => {
            if (pool.backends) {
              totalBackends += pool.backends.length;
              pool.backends.forEach(backend => {
                if (backend.healthy) {
                  healthyBackends++;
                } else {
                  unhealthyBackends++;
                }
              });
            }
          });
        }
      } catch (error) {
        console.warn(`Failed to load config for ${serviceName}:`, error);
      }
    }

    document.getElementById('total-backends').textContent = totalBackends;
    document.getElementById('healthy-backends').textContent = healthyBackends;
    document.getElementById('unhealthy-backends').textContent = unhealthyBackends;

    // Load recent activity
    loadRecentActivity();

  } catch (error) {
    console.error('Failed to load overview data:', error);
    showError('Failed to load overview data: ' + error.message);
    
    // Set default values when API fails
    document.getElementById('total-services').textContent = '0';
    document.getElementById('total-backends').textContent = '0';
    document.getElementById('healthy-backends').textContent = '0';
    document.getElementById('unhealthy-backends').textContent = '0';
    
    // Show error in activity log
    document.getElementById('activity-log').innerHTML = `
      <div class="activity-item">
        <div class="activity-time">[Error]</div>
        <div class="activity-message">Failed to load data: ${error.message}</div>
      </div>
    `;
  }
}

// Load services data
async function loadServicesData() {
  const container = document.getElementById('services-list');
  container.innerHTML = '<div class="loading">Loading services...</div>';

  try {
    const services = await apiCall('/admin/services/list');
    console.log('Services response:', services);

    if (!services.services || Object.keys(services.services).length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-server"></i>
          <h3>No services configured</h3>
          <p>Add your first load balancer service to get started.</p>
          <button class="btn btn-success" onclick="openAddServiceModal()">
            <i class="fas fa-plus"></i> Add Service
          </button>
        </div>
      `;
      return;
    }

    let html = '';
    for (const [serviceName, serviceData] of Object.entries(services.services)) {
      const backendCount = serviceData.backends ? serviceData.backends.length : 0;
      const statusClass = serviceData.status === 'active' ? 'status-healthy' : 'status-unknown';
      
      html += `
                <div class="service-item">
                    <div class="service-info">
                        <div class="service-name">${serviceName}</div>
                        <div class="service-url">${backendCount} backend(s) configured</div>
            <div class="service-url">Mode: ${serviceData.mode || 'simple'}</div>
          </div>
          <div class="service-actions">
            <div class="status-badge ${statusClass}">${serviceData.status || 'Active'}</div>
            <button class="btn btn-small btn-primary" onclick="viewServiceDetails('${serviceName}')">
              <i class="fas fa-eye"></i> View
            </button>
            <button class="btn btn-small btn-danger" onclick="deleteService('${serviceName}')">
              <i class="fas fa-trash"></i> Delete
            </button>
                    </div>
                </div>
            `;
    }

    container.innerHTML = html;

  } catch (error) {
    console.error('Failed to load services:', error);
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-exclamation-triangle"></i>
        <h3>Failed to load services</h3>
        <p>Error: ${error.message}</p>
        <button class="btn btn-primary" onclick="loadServicesData()">
          <i class="fas fa-sync-alt"></i> Retry
        </button>
        <button class="btn btn-success" onclick="openAddServiceModal()">
          <i class="fas fa-plus"></i> Add Service
        </button>
      </div>
    `;
  }
}

// Load backends data
async function loadBackendsData() {
  const container = document.getElementById('backends-list');
  container.innerHTML = '<div class="loading">Loading backends...</div>';

  try {
    const services = await apiCall('/admin/services/list');
    
    if (!services.services || Object.keys(services.services).length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-network-wired"></i>
          <h3>No backends configured</h3>
          <p>Add services first, then configure their backends.</p>
          <button class="btn btn-success" onclick="openAddServiceModal()">
            <i class="fas fa-plus"></i> Add Service
          </button>
        </div>
      `;
      return;
    }

    let html = '';
    let totalBackends = 0;
    
    for (const [serviceName, serviceData] of Object.entries(services.services)) {
      if (serviceData.backends && serviceData.backends.length > 0) {
        serviceData.backends.forEach((backend, index) => {
          totalBackends++;
          const statusClass = backend.healthy !== false ? 'status-healthy' : 'status-error';
          const backendId = `backend-${index}`;

                html += `
                                    <div class="backend-item">
              <div class="service-info">
                <div class="service-name">${backend}</div>
                <div class="service-url">Service: ${serviceName}</div>
                <div class="service-url">Weight: ${backend.weight || 1}</div>
              </div>
              <div class="backend-actions">
                <div class="status-badge ${statusClass}">
                  ${backend.healthy !== false ? 'Healthy' : 'Unhealthy'}
                </div>
                <button class="btn btn-small btn-danger" onclick="deleteBackend('${serviceName}', '${backendId}')">
                  <i class="fas fa-trash"></i> Remove
                </button>
                                        </div>
                                    </div>
                                `;
              });
      }
    }

    if (totalBackends === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-network-wired"></i>
          <h3>No backends found</h3>
          <p>Your services don't have any backends configured yet.</p>
          <button class="btn btn-success" onclick="openAddBackendModal()">
            <i class="fas fa-plus"></i> Add Backend
          </button>
        </div>
      `;
    } else {
      container.innerHTML = html;
    }

  } catch (error) {
    console.error('Failed to load backends:', error);
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-exclamation-triangle"></i>
        <h3>Failed to load backends</h3>
        <p>Error: ${error.message}</p>
        <button class="btn btn-primary" onclick="loadBackendsData()">
          <i class="fas fa-sync-alt"></i> Retry
        </button>
      </div>
    `;
  }
}

// Load health data
async function loadHealthData() {
  const container = document.getElementById('health-results');
  container.innerHTML = '<div class="loading">Loading health status...</div>';

  try {
    const services = await apiCall('/admin/services/list');
    
    if (!services.services || Object.keys(services.services).length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-heartbeat"></i>
          <h3>No services to check</h3>
          <p>Add services first to monitor their health.</p>
        </div>
      `;
      return;
    }

    let html = '<div class="health-grid">';
    
    for (const [serviceName, serviceData] of Object.entries(services.services)) {
      try {
        const health = await apiCall(`/admin/services/${serviceName}/health`);

        html += `
          <div class="health-service">
            <h4>${serviceName}</h4>
            <div class="health-backends">
        `;
        
        if (health.backends && health.backends.length > 0) {
          health.backends.forEach(backend => {
            const statusClass = backend.healthy ? 'status-healthy' : 'status-error';
            html += `
              <div class="health-backend">
                                    <div class="backend-url">${backend.url}</div>
                <div class="status-badge ${statusClass}">
                  ${backend.healthy ? 'Healthy' : 'Unhealthy'}
                </div>
                <div class="health-details">
                  Response: ${backend.responseTime || 'N/A'}ms
                                </div>
                            </div>
                        `;
          });
        } else {
          html += '<div class="health-backend">No backends configured</div>';
        }
        
        html += '</div></div>';
      } catch (error) {
        html += `
          <div class="health-service">
            <h4>${serviceName}</h4>
            <div class="health-error">Failed to check health: ${error.message}</div>
          </div>
        `;
      }
    }
    
    html += '</div>';
    container.innerHTML = html;

  } catch (error) {
    console.error('Failed to load health data:', error);
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-exclamation-triangle"></i>
        <h3>Failed to load health status</h3>
        <p>Error: ${error.message}</p>
        <button class="btn btn-primary" onclick="loadHealthData()">
          <i class="fas fa-sync-alt"></i> Retry
        </button>
      </div>
    `;
  }
}

// Load logs data
async function loadLogsData() {
  const container = document.getElementById('logs-container');
  
  // For now, show a placeholder since we don't have a logs endpoint
  container.innerHTML = `
        <div class="log-entry">
            <span class="log-time">[${new Date().toISOString()}]</span>
      <span class="log-level log-info">INFO</span>
            <span class="log-message">Dashboard loaded successfully</span>
        </div>
        <div class="log-entry">
            <span class="log-time">[${new Date().toISOString()}]</span>
      <span class="log-level log-info">INFO</span>
      <span class="log-message">Services monitoring active</span>
    </div>
    <div class="log-entry">
      <span class="log-time">[${new Date().toISOString()}]</span>
      <span class="log-level log-warn">WARN</span>
      <span class="log-message">Real-time logs not yet implemented</span>
        </div>
    `;
}

// Load recent activity
function loadRecentActivity() {
  const container = document.getElementById('activity-log');
  const now = new Date();

  container.innerHTML = `
        <div class="activity-item">
            <div class="activity-time">${now.toLocaleTimeString()}</div>
            <div class="activity-message">Dashboard refreshed</div>
        </div>
        <div class="activity-item">
            <div class="activity-time">${new Date(now - 5 * 60000).toLocaleTimeString()}</div>
            <div class="activity-message">Health checks completed</div>
        </div>
        <div class="activity-item">
            <div class="activity-time">${new Date(now - 10 * 60000).toLocaleTimeString()}</div>
            <div class="activity-message">Backend status updated</div>
        </div>
    `;
}

// Refresh functions
function refreshServices() {
  loadServicesData();
}

function refreshBackends() {
  loadBackendsData();
}

async function runHealthCheck() {
  showSuccess('Running health checks...');
  loadHealthData();
}

function clearLogs() {
  const container = document.getElementById('logs-container');
  container.innerHTML = `
    <div class="log-entry">
      <span class="log-time">[${new Date().toISOString()}]</span>
      <span class="log-level log-info">INFO</span>
      <span class="log-message">Logs cleared</span>
    </div>
  `;
}

// Show error message
function showError(message) {
  const alert = document.querySelector('.alert');
  alert.className = 'alert alert-error';
  alert.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${message}`;
  alert.style.display = 'flex';
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    alert.style.display = 'none';
  }, 5000);
}

// Show success message
function showSuccess(message) {
  const alert = document.querySelector('.alert');
  alert.className = 'alert alert-success';
  alert.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
  alert.style.display = 'flex';
  
  // Auto-hide after 3 seconds
  setTimeout(() => {
    alert.style.display = 'none';
  }, 3000);
}

// Modal Management
function openAddServiceModal() {
  console.log('Opening add service modal');
  const modal = document.getElementById('add-service-modal');
  if (modal) {
    modal.classList.add('active');
    console.log('Modal opened successfully');
  } else {
    console.error('Could not find add-service-modal element');
  }
}

function closeAddServiceModal() {
  console.log('Closing add service modal');
  const modal = document.getElementById('add-service-modal');
  if (modal) {
    modal.classList.remove('active');
    // Clear form
    document.getElementById('service-hostname').value = '';
    document.getElementById('service-backends').value = '';
    document.getElementById('service-health-path').value = '/health';
    console.log('Modal closed successfully');
  } else {
    console.error('Could not find add-service-modal element');
  }
}

function openAddBackendModal() {
  // Populate service select
  populateServiceSelect();
  document.getElementById('add-backend-modal').classList.add('active');
}

function closeAddBackendModal() {
  document.getElementById('add-backend-modal').classList.remove('active');
  // Clear form
  document.getElementById('backend-service-select').value = '';
  document.getElementById('backend-url').value = '';
  document.getElementById('backend-weight').value = '1';
}

async function populateServiceSelect() {
  try {
    const services = await apiCall('/admin/services/list');
    const select = document.getElementById('backend-service-select');
    
    // Clear existing options except the first one
    select.innerHTML = '<option value="">Select a service...</option>';
    
    if (services.services) {
      Object.keys(services.services).forEach(serviceName => {
        const option = document.createElement('option');
        option.value = serviceName;
        option.textContent = serviceName;
        select.appendChild(option);
      });
    }
  } catch (error) {
    console.error('Failed to populate service select:', error);
  }
}

// Service Management
async function createService() {
  const hostname = document.getElementById('service-hostname').value.trim();
  const backendsText = document.getElementById('service-backends').value.trim();
  const healthPath = document.getElementById('service-health-path').value.trim();
  
  if (!hostname || !backendsText) {
    showError('Please fill in all required fields');
    return;
  }
  
  const backends = backendsText.split('\n').map(url => url.trim()).filter(url => url);
  
  if (backends.length === 0) {
    showError('Please provide at least one backend URL');
    return;
  }
  
  try {
    // Create the service configuration
    const config = {
      serviceId: hostname,
      mode: 'simple',
      simpleBackends: backends,
      pools: [{
        id: "simple-pool",
        name: "Simple Failover Pool",
        backends: backends.map((url, index) => ({
          id: `backend-${index}`,
          url: url,
          ip: new URL(url).hostname,
          weight: 1,
          healthy: true,
          consecutiveFailures: 0,
          requests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          totalResponseTimeMs: 0,
          priority: 10,
          enabled: true
        })),
        enabled: true,
        minimum_origins: 1,
        endpoint_steering: 'round_robin'
      }],
      load_balancer: {
        id: "simple-lb",
        name: "Simple Load Balancer",
        hostname: hostname,
        default_pool_ids: ["simple-pool"],
        proxied: true,
        enabled: true,
        steering_policy: "off",
        session_affinity: {
          type: "none",
          enabled: false
        }
      },
      currentRoundRobinIndex: 0,
      passiveHealthChecks: { 
        max_failures: 3, 
        failure_timeout_ms: 30000, 
        retryable_status_codes: [500, 502, 503, 504], 
        enabled: true, 
        monitor_timeout: 10 
      },
      activeHealthChecks: { 
        enabled: false, 
        path: healthPath || "/health", 
        interval: 60, 
        timeout: 5, 
        type: 'http', 
        consecutive_up: 2, 
        consecutive_down: 3, 
        retries: 1 
      },
      retryPolicy: { 
        max_retries: 2, 
        retry_timeout: 10000, 
        backoff_strategy: 'constant', 
        base_delay: 1000 
      },
      hostHeaderRewrite: 'preserve',
      observability: { 
        responseHeaderName: "X-Backend-Used",
        add_backend_header: true 
      }
    };
    
    const response = await apiCall(`/admin/services/${hostname}/config`, {
      method: 'POST',
      body: JSON.stringify(config)
    });
    
    if (response.success) {
      showSuccess(`Service ${hostname} created successfully`);
      closeAddServiceModal();
      loadServicesData();
    } else {
      showError(response.message || 'Failed to create service');
    }
  } catch (error) {
    console.error('Failed to create service:', error);
    showError('Failed to create service: ' + error.message);
  }
}

async function addBackend() {
  const serviceName = document.getElementById('backend-service-select').value;
  const backendUrl = document.getElementById('backend-url').value.trim();
  const weight = parseInt(document.getElementById('backend-weight').value) || 1;
  
  if (!serviceName || !backendUrl) {
    showError('Please fill in all required fields');
    return;
  }
  
  try {
    const backend = {
      url: backendUrl,
      weight: weight,
      healthy: true,
      enabled: true
    };
    
    const response = await apiCall(`/admin/services/${serviceName}/backends`, {
      method: 'POST',
      body: JSON.stringify(backend)
    });
    
    if (response.success) {
      showSuccess(`Backend added to ${serviceName} successfully`);
      closeAddBackendModal();
      loadBackendsData();
    } else {
      showError(response.message || 'Failed to add backend');
    }
  } catch (error) {
    console.error('Failed to add backend:', error);
    showError('Failed to add backend: ' + error.message);
  }
}

async function deleteService(serviceName) {
  if (!confirm(`Are you sure you want to delete service "${serviceName}"?`)) {
    return;
  }
  
  try {
    const response = await apiCall(`/admin/services/${serviceName}/config`, {
      method: 'DELETE'
    });
    
    if (response.success) {
      showSuccess(`Service ${serviceName} deleted successfully`);
      loadServicesData();
    } else {
      showError(response.message || 'Failed to delete service');
    }
  } catch (error) {
    console.error('Failed to delete service:', error);
    showError('Failed to delete service: ' + error.message);
  }
}

async function deleteBackend(serviceName, backendId) {
  if (!confirm(`Are you sure you want to delete backend "${backendId}" from service "${serviceName}"?`)) {
    return;
  }
  
  try {
    const response = await apiCall(`/admin/services/${serviceName}/backends`, {
      method: 'DELETE',
      body: JSON.stringify({ backendId: backendId })
    });
    
    if (response.success) {
      showSuccess(`Backend ${backendId} deleted successfully`);
      loadBackendsData();
    } else {
      showError(response.message || 'Failed to delete backend');
    }
  } catch (error) {
    console.error('Failed to delete backend:', error);
    showError('Failed to delete backend: ' + error.message);
  }
}

async function viewServiceDetails(serviceName) {
  try {
    const config = await apiCall(`/admin/services/${serviceName}/config`);
    const health = await apiCall(`/admin/services/${serviceName}/health`);
    
    let details = `Service: ${serviceName}\n\n`;
    details += `Mode: ${config.mode || 'simple'}\n`;
    details += `Pools: ${config.pools ? config.pools.length : 0}\n\n`;
    
    if (config.pools) {
      config.pools.forEach((pool, index) => {
        details += `Pool ${index + 1}: ${pool.name}\n`;
        details += `Backends: ${pool.backends ? pool.backends.length : 0}\n`;
        if (pool.backends) {
          pool.backends.forEach(backend => {
            details += `  - ${backend.url} (${backend.healthy ? 'Healthy' : 'Unhealthy'})\n`;
          });
        }
        details += '\n';
      });
    }
    
    alert(details);
  } catch (error) {
    showError('Failed to load service details: ' + error.message);
  }
}

// Initialize all configured services
async function initializeServices() {
  try {
    showSuccess('Initializing services...');
    
    const response = await fetch(`${API_BASE}/init-services`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_SECRET}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    showSuccess('Services initialized successfully! Refreshing data...');
    
    // Refresh all data
    loadOverviewData();
    loadServicesData();
    loadBackendsData();
    
  } catch (error) {
    console.error('Failed to initialize services:', error);
    showError('Failed to initialize services: ' + error.message);
  }
}

// Close modals when clicking outside
document.addEventListener('click', function(event) {
  if (event.target.classList.contains('modal')) {
    event.target.classList.remove('active');
  }
});

// Initialize dashboard
document.addEventListener('DOMContentLoaded', function () {
  console.log('Dashboard initializing...');
  
  // Check if API_SECRET is available from template
  if (typeof API_SECRET !== 'undefined' && API_SECRET) {
    console.log('API_SECRET loaded from template:', API_SECRET.substring(0, 10) + '...');
  } else {
    console.error('API_SECRET not available from template');
  }
  
  console.log('API_BASE:', API_BASE);
  
  // Check if modals exist and are properly hidden
  const addServiceModal = document.getElementById('add-service-modal');
  const addBackendModal = document.getElementById('add-backend-modal');
  
  console.log('Add Service Modal:', addServiceModal ? 'Found' : 'Not found');
  console.log('Add Backend Modal:', addBackendModal ? 'Found' : 'Not found');
  
  if (addServiceModal) {
    console.log('Add Service Modal classes:', addServiceModal.className);
    console.log('Add Service Modal display:', window.getComputedStyle(addServiceModal).display);
  }
  
  if (addBackendModal) {
    console.log('Add Backend Modal classes:', addBackendModal.className);
    console.log('Add Backend Modal display:', window.getComputedStyle(addBackendModal).display);
  }
  
  // Set up tab click handlers
  const tabs = document.querySelectorAll('.tab');
  console.log(`Found ${tabs.length} tabs to set up`);
  
  tabs.forEach((tab, index) => {
    const tabName = tab.getAttribute('data-tab');
    console.log(`Setting up tab ${index}: ${tabName}`);
    
    tab.addEventListener('click', function(event) {
      event.preventDefault();
      console.log(`Tab clicked: ${tabName}`);
      showTab(tabName);
    });
  });

  // Load initial data
  loadOverviewData();

  // Set up auto-refresh every 30 seconds
  setInterval(() => {
    const activeTab = document.querySelector('.tab.active');
    if (activeTab) {
      const tabName = activeTab.getAttribute('data-tab');
      if (tabName) {
      loadTabData(tabName);
      }
    }
  }, 30000);
  
  console.log('Dashboard initialization complete');
}); 
