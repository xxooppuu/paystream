/**
 * API Configuration
 * 
 * Manages the backend API URL.
 * Defaults to using the PHP backend structure (?act=endpoint) for ensuring compatibility with simple web servers.
 * You can toggle `USE_PHP_BACKEND` to false to use the Node.js backend (http://localhost:3001/endpoint).
 */

const USE_PHP_BACKEND = true; // Set to true for PHP deployment

export const getApiUrl = (endpoint: string): string => {
    // If using PHP Backend, we map endpoints to the 'act' query parameter
    // e.g., 'shops' -> 'api.php?act=shops'
    if (USE_PHP_BACKEND) {
        // Special case for proxy which might just be a direct POST to api.php?act=proxy
        return `/api.php?act=${endpoint}`;
    }

    // Node.js Backend (Local Dev)
    return `http://localhost:3001/${endpoint}`;
};

/**
 * Helper to get the Proxy URL specifically, as it's used frequently.
 */
export const PROXY_URL = getApiUrl('proxy');
// v2.2.69: Centralized Version Management
export const APP_VERSION = 'v2.2.124';
