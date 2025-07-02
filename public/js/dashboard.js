// Dashboard JavaScript for real-time updates and interactions
class LoadBalancerDashboard {
  constructor() {
    this.refreshInterval = 30000; // 30 seconds
    this.charts = {};
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.startAutoRefresh();
    this.loadInitialData();
  }

  setupEventListeners() {
    // Refresh button
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.refreshData());
    }

    // Auto-refresh toggle
    const autoRefreshToggle = document.getElementById('auto-refresh');
    if (autoRefreshToggle) {
      autoRefreshToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.startAutoRefresh();
        } else {
          this.stopAutoRefresh();
        }
      });
    }

    // Backend action buttons
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('backend-action')) {
        this.handleBackendAction(e.target);
      }
    });
  }

  async loadInitialData() {
    try {
      await this.refreshData();
    } catch (error) {
      console.error('Failed to load initial data:', error);
      this.showError('Failed to load dashboard data');
    }
  }

  async refreshData() {
    try {
      this.showLoading(true);
      
      // Fetch latest stats
      const response = await fetch('/api/stats');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      this.updateStats(data.stats);
      this.updateBackends(data.backends);
      this.updateCharts(data.metrics);
      
      this.showLoading(false);
      this.updateLastRefresh();
    } catch (error) {
      console.error('Failed to refresh data:', error);
      this.showError('Failed to refresh dashboard data');
      this.showLoading(false);
    }
  }

  updateStats(stats) {
    const statElements = {
      'total-requests': stats.totalRequests,
      'active-backends': `${stats.activeBackends}/${stats.totalBackends}`,
      'average-response-time': `${stats.averageResponseTime.toFixed(2)}ms`,
      'error-rate': `${(stats.errorRate * 100).toFixed(2)}%`,
      'requests-per-second': stats.requestsPerSecond.toFixed(2),
      'uptime': this.formatUptime(stats.uptime)
    };

    Object.entries(statElements).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) {
        element.textContent = value;
        this.animateValueChange(element);
      }
    });
  }

  updateBackends(backends) {
    const container = document.getElementById('backends-list');
    if (!container) return;

    container.innerHTML = backends.map(backend => `
      <div class="backend-item ${backend.healthy ? 'healthy' : 'unhealthy'}" data-backend-id="${backend.id}">
        <div class="status-indicator ${backend.healthy ? 'status-healthy' : 'status-unhealthy'}"></div>
        <div class="backend-info">
          <div class="backend-url">${backend.url}</div>
          <div class="backend-pool">Pool: ${backend.pool}</div>
          <div class="backend-metrics">
            Requests: ${backend.requests || 0} | 
            Avg Response: ${backend.avgResponseTime ? backend.avgResponseTime.toFixed(2) + 'ms' : 'N/A'} |
            Success Rate: ${backend.successRate ? (backend.successRate * 100).toFixed(1) + '%' : 'N/A'}
          </div>
        </div>
        <div class="backend-actions">
          <button class="btn btn-sm btn-secondary backend-action" data-action="test" data-backend="${backend.id}">
            Test
          </button>
          <button class="btn btn-sm ${backend.healthy ? 'btn-warning' : 'btn-success'} backend-action" 
                  data-action="${backend.healthy ? 'disable' : 'enable'}" data-backend="${backend.id}">
            ${backend.healthy ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>
    `).join('');
  }

  updateCharts(metrics) {
    // Update response time chart
    this.updateResponseTimeChart(metrics.responseTime);
    
    // Update request rate chart
    this.updateRequestRateChart(metrics.requestRate);
    
    // Update error rate chart
    this.updateErrorRateChart(metrics.errorRate);
  }

  updateResponseTimeChart(data) {
    const canvas = document.getElementById('response-time-chart');
    if (!canvas) return;

    // Simple canvas-based chart implementation
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    
    if (!data || data.length === 0) return;

    const maxValue = Math.max(...data.map(d => d.value));
    const step = width / (data.length - 1);

    ctx.strokeStyle = '#4299e1';
    ctx.lineWidth = 2;
    ctx.beginPath();

    data.forEach((point, index) => {
      const x = index * step;
      const y = height - (point.value / maxValue) * height;
      
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();
  }

  updateRequestRateChart(data) {
    // Similar implementation for request rate
    const canvas = document.getElementById('request-rate-chart');
    if (!canvas) return;
    
    // Implementation similar to response time chart
    this.drawLineChart(canvas, data, '#48bb78');
  }

  updateErrorRateChart(data) {
    // Similar implementation for error rate
    const canvas = document.getElementById('error-rate-chart');
    if (!canvas) return;
    
    // Implementation similar to response time chart
    this.drawLineChart(canvas, data, '#f56565');
  }

  drawLineChart(canvas, data, color) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    
    if (!data || data.length === 0) return;

    const maxValue = Math.max(...data.map(d => d.value));
    const step = width / (data.length - 1);

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    data.forEach((point, index) => {
      const x = index * step;
      const y = height - (point.value / maxValue) * height;
      
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();
  }

  async handleBackendAction(button) {
    const action = button.dataset.action;
    const backendId = button.dataset.backend;
    
    try {
      button.disabled = true;
      button.textContent = 'Processing...';
      
      const response = await fetch(`/admin/services/default/backends/${backendId}/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      this.showSuccess(`Backend ${action} successful`);
      
      // Refresh data to show updated status
      setTimeout(() => this.refreshData(), 1000);
      
    } catch (error) {
      console.error(`Backend ${action} failed:`, error);
      this.showError(`Failed to ${action} backend`);
    } finally {
      button.disabled = false;
      // Reset button text based on action
      button.textContent = action === 'test' ? 'Test' : 
                          action === 'enable' ? 'Enable' : 'Disable';
    }
  }

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshTimer = setInterval(() => {
      this.refreshData();
    }, this.refreshInterval);
  }

  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  showLoading(show) {
    const loader = document.getElementById('loading-indicator');
    if (loader) {
      loader.style.display = show ? 'block' : 'none';
    }
  }

  showError(message) {
    this.showNotification(message, 'error');
  }

  showSuccess(message) {
    this.showNotification(message, 'success');
  }

  showNotification(message, type) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    // Add to page
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 5000);
  }

  animateValueChange(element) {
    element.classList.add('value-updated');
    setTimeout(() => {
      element.classList.remove('value-updated');
    }, 1000);
  }

  updateLastRefresh() {
    const element = document.getElementById('last-refresh');
    if (element) {
      element.textContent = new Date().toLocaleTimeString();
    }
  }

  formatUptime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.dashboard = new LoadBalancerDashboard();
});

// Add CSS for notifications
const notificationStyles = `
<style>
.notification {
  position: fixed;
  top: 20px;
  right: 20px;
  padding: 12px 20px;
  border-radius: 4px;
  color: white;
  font-weight: 500;
  z-index: 1000;
  animation: slideIn 0.3s ease-out;
}

.notification-success {
  background: #48bb78;
}

.notification-error {
  background: #f56565;
}

.value-updated {
  animation: highlight 1s ease-out;
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes highlight {
  0% { background-color: #4299e1; }
  100% { background-color: transparent; }
}

#loading-indicator {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 20px;
  border-radius: 4px;
  z-index: 1001;
}
</style>
`;

document.head.insertAdjacentHTML('beforeend', notificationStyles); 