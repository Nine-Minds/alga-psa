const API_BASE = 'http://localhost:4000/api';

interface ApiRequestBody {
  code?: string;
  [key: string]: unknown;
}

interface ApiResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

// Helper function to log API calls
function logApiCall(method: string, endpoint: string, body?: ApiRequestBody) {
  console.log(`[API ${method}] ${endpoint}`);
  if (body) {
    console.log('Request body:', body);
  }
}

// Helper function to log API responses
function logApiResponse(endpoint: string, response: ApiResponse | null, error?: unknown) {
  if (error) {
    console.error(`[API ERROR] ${endpoint}:`, error);
    return;
  }
  console.log(`[API Response] ${endpoint}:`, response);
}

// 1) Observe Browser
export async function observeBrowser() {
  const endpoint = `${API_BASE}/observe`;
  logApiCall('GET', endpoint);

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
    });
    
    if (!response.ok) {
      const error = `Failed to observe: ${response.status}`;
      logApiResponse(endpoint, null, error);
      throw new Error(error);
    }

    const result = await response.json();
    logApiResponse(endpoint, result);
    return result;
  } catch (error) {
    const errorResult = {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
    logApiResponse(endpoint, null, errorResult);
    return errorResult;
  }
}

// 2) Execute Browser Script
export async function executeScript(code: string) {
  const endpoint = `${API_BASE}/script`;
  const body = { code };
  logApiCall('POST', endpoint, body);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = `Failed to execute script: ${response.status}`;
      logApiResponse(endpoint, null, error);
      throw new Error(error);
    }

    const result = await response.json();
    const successResult = { success: true, result };
    logApiResponse(endpoint, successResult);
    return successResult;
  } catch (error) {
    const errorResult = {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
    logApiResponse(endpoint, null, errorResult);
    return errorResult;
  }
}

// 3) Execute Node Script
export async function executeNodeScript(code: string) {
  const endpoint = `${API_BASE}/node-script`;
  const body = { code };
  logApiCall('POST', endpoint, body);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = `Failed to execute node script: ${response.status}`;
      logApiResponse(endpoint, null, error);
      throw new Error(error);
    }

    const result = await response.json();
    const successResult = { success: true, result };
    logApiResponse(endpoint, successResult);
    return successResult;
  } catch (error) {
    const errorResult = {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
    logApiResponse(endpoint, null, errorResult);
    return errorResult;
  }
}
