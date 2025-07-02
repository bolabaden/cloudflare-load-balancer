// Control Panel JavaScript for load balancer configuration management
class ControlPanel {
  constructor() {
    this.apiBase = '/admin/services';
    this.currentService = 'default';
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.loadServiceConfiguration();
  }

  setupEventListeners() {
    // Service configuration form
    const configForm = document.getElementById('service-config-form');
    if (configForm) {
      configForm.addEventListener('submit', (e) => this.handleConfigUpdate(e));
    }

    // Action buttons
    const actionButtons = {
      'triggerHealthCheck': () => this.triggerHealthCheck(),
      'exportConfig': () => this.exportConfig(),
      'importConfig': () => this.importConfig(),
      'resetMetrics': () => this.resetMetrics()
    };

    Object.entries(actionButtons).forEach(([action, handler]) => {
      document.addEventListener('click', (e) => {
        if (e.target.matches(`[onclick*="${action}"]`)) {
          e.preventDefault();
          handler();
        }
      });
    });
  }

  async loadServiceConfiguration() {
    try {
      this.showLoading(true);
      const response = await fetch(`${this.apiBase}/${this.currentService}`);
      
      if (!response.ok) {
        throw new Error(`Failed to load configuration: ${response.statusText}`);
      }
      
      const config = await response.json();
      this.currentConfig = config;
      this.populateForm(config);
      
    } catch (error) {
      console.error('Failed to load service configuration:', error);
      this.showError('Failed to load service configuration');
    } finally {
      this.showLoading(false);
    }
  }

  populateForm(config) {
    // Populate service name
    const serviceNameInput = document.getElementById('service-name');
    if (serviceNameInput) {
      serviceNameInput.value = config.serviceId || '';
    }

    // Populate algorithm
    const algorithmSelect = document.getElementById('algorithm');
    if (algorithmSelect && config.load_balancer) {
      const steeringPolicy = config.load_balancer.steering_policy;
      let algorithmValue = 'round-robin';
      
      switch (steeringPolicy) {
        case 'random':
          algorithmValue = 'weighted';
          break;
        case 'least_connections':
          algorithmValue = 'least-connections';
          break;
        default:
          algorithmValue = 'round-robin';
      }
      
      algorithmSelect.value = algorithmValue;
    }

    // Populate health check settings
    if (config.activeHealthChecks) {
      const healthCheckEnabled = document.getElementById('health-check-enabled');
      const healthCheckInterval = document.getElementById('health-check-interval');
      const healthCheckTimeout = document.getElementById('health-check-timeout');
      const healthCheckPath = document.getElementById('health-check-path');

      if (healthCheckEnabled) healthCheckEnabled.checked = config.activeHealthChecks.enabled || false;
      if (healthCheckInterval) healthCheckInterval.value = config.activeHealthChecks.interval || 30;
      if (healthCheckTimeout) healthCheckTimeout.value = config.activeHealthChecks.timeout || 5;
      if (healthCheckPath) healthCheckPath.value = config.activeHealthChecks.path || '/health';
    }

    // Refresh pools display
    this.refreshPoolsDisplay();
  }

  async handleConfigUpdate(event) {
    event.preventDefault();
    
    try {
      this.showLoading(true);
      
      const formData = new FormData(event.target);
      const updates = {
        serviceId: formData.get('name'),
        load_balancer: {
          ...this.currentConfig.load_balancer,
          steering_policy: this.mapAlgorithmToSteeringPolicy(formData.get('algorithm'))
        },
        activeHealthChecks: {
          ...this.currentConfig.activeHealthChecks,
          enabled: document.getElementById('health-check-enabled').checked,
          interval: parseInt(document.getElementById('health-check-interval').value),
          timeout: parseInt(document.getElementById('health-check-timeout').value),
          path: document.getElementById('health-check-path').value
        }
      };

      const response = await fetch(`${this.apiBase}/${this.currentService}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      });

      if (!response.ok) {
        throw new Error(`Failed to update configuration: ${response.statusText}`);
      }

      this.showSuccess('Configuration updated successfully');
      await this.loadServiceConfiguration();
      
    } catch (error) {
      console.error('Failed to update configuration:', error);
      this.showError('Failed to update configuration');
    } finally {
      this.showLoading(false);
    }
  }

  mapAlgorithmToSteeringPolicy(algorithm) {
    switch (algorithm) {
      case 'weighted':
        return 'random';
      case 'least-connections':
        return 'least_connections';
      default:
        return 'off';
    }
  }

  async triggerHealthCheck() {
    try {
      this.showLoading(true);
      const response = await fetch(`${this.apiBase}/${this.currentService}/health-check`, {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.statusText}`);
      }

      this.showSuccess('Health check completed');
      await this.loadServiceConfiguration();
    } catch (error) {
      console.error('Health check failed:', error);
      this.showError('Health check failed');
    } finally {
      this.showLoading(false);
    }
  }

  async exportConfig() {
    try {
      const response = await fetch(`${this.apiBase}/${this.currentService}`);
      const config = await response.json();
      
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `loadbalancer-config-${this.currentService}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      URL.revokeObjectURL(url);
      this.showSuccess('Configuration exported');
    } catch (error) {
      console.error('Export failed:', error);
      this.showError('Failed to export configuration');
    }
  }

  async importConfig() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const config = JSON.parse(text);
        
        if (confirm('This will replace the current configuration. Continue?')) {
          const response = await fetch(`${this.apiBase}/${this.currentService}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
          });

          if (!response.ok) {
            throw new Error(`Import failed: ${response.statusText}`);
          }

          this.showSuccess('Configuration imported successfully');
          await this.loadServiceConfiguration();
        }
      } catch (error) {
        console.error('Import failed:', error);
        this.showError('Failed to import configuration');
      }
    };
    
    input.click();
  }

  async resetMetrics() {
    if (!confirm('This will reset all metrics data. Continue?')) return;

    try {
      const response = await fetch(`${this.apiBase}/${this.currentService}/metrics`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(`Reset failed: ${response.statusText}`);
      }

      this.showSuccess('Metrics reset successfully');
    } catch (error) {
      console.error('Reset failed:', error);
      this.showError('Failed to reset metrics');
    }
  }

  refreshPoolsDisplay() {
    const container = document.getElementById('pools-container');
    if (!container || !this.currentConfig?.pools) return;

    container.innerHTML = this.currentConfig.pools.map((pool, poolIndex) => `
      <div class="pool-section" data-pool-index="${poolIndex}">
        <div class="pool-header">
          <div class="pool-name">Pool: ${pool.name}</div>
        </div>
        
        <div class="backend-list">
          <h4>Backends</h4>
          ${this.renderBackends(pool.backends, poolIndex)}
        </div>
      </div>
    `).join('');
  }

  renderBackends(backends, poolIndex) {
    return backends.map((backend, backendIndex) => `
      <div class="backend-item ${backend.healthy ? 'healthy' : 'unhealthy'}" data-backend-index="${backendIndex}">
        <div class="status-indicator ${backend.healthy ? 'status-healthy' : 'status-unhealthy'}"></div>
        <div class="backend-info">
          <div class="backend-url">${backend.url}</div>
          <div class="backend-details">
            Weight: ${backend.weight || 1} | 
            Status: ${backend.healthy ? 'Healthy' : 'Unhealthy'} |
            Requests: ${backend.requests || 0}
          </div>
        </div>
      </div>
    `).join('');
  }

  showLoading(show) {
    const loader = document.getElementById('loading-indicator') || this.createLoader();
    loader.style.display = show ? 'block' : 'none';
  }

  createLoader() {
    const loader = document.createElement('div');
    loader.id = 'loading-indicator';
    loader.innerHTML = 'Loading...';
    loader.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 20px;
      border-radius: 4px;
      z-index: 1001;
      display: none;
    `;
    document.body.appendChild(loader);
    return loader;
  }

  showError(message) {
    this.showNotification(message, 'error');
  }

  showSuccess(message) {
    this.showNotification(message, 'success');
  }

  showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 4px;
      color: white;
      font-weight: 500;
      z-index: 1000;
      animation: slideIn 0.3s ease-out;
      background: ${type === 'success' ? '#48bb78' : '#f56565'};
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 5000);
  }
}

// Global functions for onclick handlers
window.triggerHealthCheck = () => window.controlPanel?.triggerHealthCheck();
window.exportConfig = () => window.controlPanel?.exportConfig();
window.importConfig = () => window.controlPanel?.importConfig();
window.resetMetrics = () => window.controlPanel?.resetMetrics();

// Initialize control panel when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.controlPanel = new ControlPanel();
});
