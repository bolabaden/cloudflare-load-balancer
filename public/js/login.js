document.addEventListener('DOMContentLoaded', () => {
    // Get error from URL if present
    const urlParams = new URLSearchParams(window.location.search);
    const error = urlParams.get('error');
    
    if (error) {
        const errorContainer = document.getElementById('error-container');
        errorContainer.innerHTML = `<div class="error">${decodeURIComponent(error)}</div>`;
    }

    // Handle form submission
    const form = document.querySelector('.basic-auth-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        
        try {
            const response = await fetch('/auth/basic', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
            });
            
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Authentication failed');
            }
            
            // Redirect to dashboard on success
            window.location.href = '/dashboard';
        } catch (error) {
            const errorContainer = document.getElementById('error-container');
            errorContainer.innerHTML = `<div class="error">${error.message}</div>`;
        }
    });
}); 